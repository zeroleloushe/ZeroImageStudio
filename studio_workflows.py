"""Build ComfyUI API-format workflows for the two generic Studio pipelines.

Создание (create): checkpoint or diffusion model + text encoder + VAE + LoRAs + sampler.
Редактирование (edit): the same loaders, then one of
  - inpaint / img2img via core nodes (any model),
  - Qwen Image 2.1 via core TextEncodeQwenImage21,
  - Krea 2 Edit via the embedded StudioKrea2Edit* nodes (or the optional external pack).

No per-model Python. A hint or a preset only fills this spec.
"""

from __future__ import annotations

from typing import Any


class WorkflowError(Exception):
    pass


def snap(n: int, step: int, minimum: int = 64) -> int:
    n = int(n)
    step = max(1, int(step))
    snapped = int((n + step / 2) // step) * step
    if snapped < minimum:
        snapped = minimum
    # keep the multiple when minimum itself is not aligned
    if snapped % step:
        snapped = int((snapped + step - 1) // step) * step
    return snapped


def assemble_prompt(user: str, presets: list | None, loras: list | None) -> str:
    """Join prompt presets and LoRA triggers around the user text.

    Presets are not written into the text box; this is the string actually sampled.
    """
    start: list[str] = []
    end: list[str] = []
    for lora in loras or []:
        if not lora or not lora.get("enabled", True):
            continue
        mode = lora.get("trigger_mode") or "off"
        if mode not in ("start", "end"):
            continue
        words: list[str] = []
        for trig in lora.get("triggers") or []:
            if isinstance(trig, str):
                if trig.strip():
                    words.append(trig.strip())
            elif isinstance(trig, dict) and trig.get("enabled", True):
                text = (trig.get("text") or "").strip()
                if text:
                    words.append(text)
        if not words:
            continue
        (start if mode == "start" else end).append(", ".join(words))

    before: list[str] = []
    after: list[str] = []
    for preset in presets or []:
        if not preset or not preset.get("enabled", True):
            continue
        text = (preset.get("text") or "").strip()
        if not text:
            continue
        (after if preset.get("position") == "after" else before).append(text)

    parts = [*start, *before, (user or "").strip(), *after, *end]
    return ", ".join(p for p in parts if p)


class _Graph:
    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        self._i = 0

    def add(self, class_type: str, inputs: dict, title: str | None = None) -> str:
        self._i += 1
        nid = str(self._i)
        node: dict[str, Any] = {"class_type": class_type, "inputs": inputs}
        if title:
            node["_meta"] = {"title": title}
        self.nodes[nid] = node
        return nid

    @staticmethod
    def ref(nid: str, out: int = 0) -> list:
        return [nid, out]


def _enabled_loras(spec: dict) -> list[dict]:
    out = []
    for lora in spec.get("loras") or []:
        if not lora or not lora.get("enabled", True):
            continue
        name = (lora.get("name") or "").strip()
        if not name:
            continue
        out.append(lora)
    return out


def _require_files(spec: dict) -> None:
    loader = spec.get("loader") or "diffusion"
    if loader == "checkpoint":
        if not (spec.get("checkpoint") or "").strip():
            raise WorkflowError("Не выбран checkpoint для этого пайплайна.")
    else:
        missing = [k for k in ("unet", "clip", "vae") if not (spec.get(k) or "").strip()]
        if missing:
            names = {"unet": "diffusion-модель", "clip": "текстовый энкодер", "vae": "VAE"}
            raise WorkflowError(
                "Не выбраны файлы: " + ", ".join(names[k] for k in missing) + "."
            )


def _add_loaders(g: _Graph, spec: dict):
    _require_files(spec)
    if (spec.get("loader") or "diffusion") == "checkpoint":
        nid = g.add("CheckpointLoaderSimple", {"ckpt_name": spec["checkpoint"]}, "Checkpoint")
        model, clip, vae = g.ref(nid, 0), g.ref(nid, 1), g.ref(nid, 2)
    else:
        unet = g.add(
            "UNETLoader",
            {
                "unet_name": spec["unet"],
                "weight_dtype": spec.get("weight_dtype") or "default",
            },
            "UNET",
        )
        clip_inputs = {
            "clip_name": spec["clip"],
            "type": spec.get("clip_type") or "stable_diffusion",
            "device": spec.get("clip_device") or "default",
        }
        clipn = g.add("CLIPLoader", clip_inputs, "CLIP")
        vaen = g.add("VAELoader", {"vae_name": spec["vae"]}, "VAE")
        model, clip, vae = g.ref(unet, 0), g.ref(clipn, 0), g.ref(vaen, 0)

    for lora in _enabled_loras(spec):
        nid = g.add(
            "LoraLoader",
            {
                "model": model,
                "clip": clip,
                "lora_name": lora["name"],
                "strength_model": float(lora.get("strength_model", 1.0)),
                "strength_clip": float(lora.get("strength_clip", 1.0)),
            },
            lora["name"],
        )
        model, clip = g.ref(nid, 0), g.ref(nid, 1)
    return model, clip, vae


def _load_image(g: _Graph, filename: str, title: str) -> str:
    if not filename:
        raise WorkflowError(f"Не передано изображение ({title}).")
    return g.add("LoadImage", {"image": filename}, title)


def _encode_clip(g: _Graph, clip, text: str, title: str) -> str:
    return g.add("CLIPTextEncode", {"text": text, "clip": clip}, title)


def _sampler(g: _Graph, spec: dict, model, positive, negative, latent, denoise: float) -> str:
    seed = int(spec.get("seed") or 0)
    if seed < 0:
        seed = 0
    return g.add(
        "KSampler",
        {
            "model": model,
            "seed": seed,
            "steps": max(1, int(spec.get("steps") or 20)),
            "cfg": float(spec.get("cfg") if spec.get("cfg") is not None else 7.0),
            "sampler_name": spec.get("sampler") or "euler",
            "scheduler": spec.get("scheduler") or "normal",
            "positive": positive,
            "negative": negative,
            "latent_image": latent,
            "denoise": float(denoise),
        },
        "KSampler",
    )


def _save(g: _Graph, samples, vae, prefix: str) -> str:
    decoded = g.add("VAEDecode", {"samples": samples, "vae": vae}, "VAEDecode")
    return g.add(
        "SaveImage",
        {"images": g.ref(decoded, 0), "filename_prefix": prefix or "studio/gen"},
        "Save",
    )


def _latent_node(spec: dict, w: int, h: int, batch: int) -> tuple[str, dict, int]:
    mode = spec.get("latent_mode") or "standard"
    if mode == "sd3":
        w, h = snap(w, 16), snap(h, 16)
        return "EmptySD3LatentImage", {"width": w, "height": h, "batch_size": batch}, 16
    w, h = snap(w, 8), snap(h, 8)
    return "EmptyLatentImage", {"width": w, "height": h, "batch_size": batch}, 8


def _size(spec: dict, step: int) -> tuple[int, int, int]:
    batch = max(1, min(8, int(spec.get("batch") or 1)))
    w = snap(int(spec.get("width") or 1024), step)
    h = snap(int(spec.get("height") or 1024), step)
    return w, h, batch


def build_create(spec: dict, warnings: list[str]) -> dict:
    """Generic text-to-image, img2img, or masked inpaint. One implementation."""
    g = _Graph()
    model, clip, vae = _add_loaders(g, spec)
    prompt = spec.get("final_prompt")
    if prompt is None:
        prompt = assemble_prompt(spec.get("prompt") or "", spec.get("prompt_presets"), spec.get("loras"))
    negative = (spec.get("negative") or "").strip()
    encoder = spec.get("encoder") or "clip"
    has_image = bool(spec.get("image"))
    has_mask = bool(spec.get("mask")) and bool(spec.get("has_mask"))
    denoise = float(spec.get("denoise") if spec.get("denoise") is not None else 1.0)

    if encoder == "qwen_image_21":
        if has_mask:
            warnings.append(
                "Для Qwen Image 2.1 маска не режет шум сэмплера: модель видит весь кроп, маска ограничивает только вклейку."
            )
        return _build_qwen(g, spec, warnings, model, clip, vae, prompt, negative, include_image=has_image or has_mask)

    step = 16 if (spec.get("latent_mode") == "sd3") else 8
    w, h, batch = _size(spec, step)
    pos = _encode_clip(g, clip, prompt, "Positive")
    neg = _encode_clip(g, clip, negative, "Negative")

    if has_mask and has_image:
        img = _load_image(g, spec["image"], "Crop")
        mask_img = _load_image(g, spec["mask"], "Mask")
        mask = g.add("ImageToMask", {"image": g.ref(mask_img, 0), "channel": "red"}, "ImageToMask")
        mode = spec.get("inpaint_mode") or "vae_encode"
        if mode == "inpaint_conditioning":
            cond = g.add(
                "InpaintModelConditioning",
                {
                    "positive": g.ref(pos, 0),
                    "negative": g.ref(neg, 0),
                    "vae": vae,
                    "pixels": g.ref(img, 0),
                    "mask": g.ref(mask, 0),
                    "noise_mask": True,
                },
                "InpaintModelConditioning",
            )
            positive, negative, latent = g.ref(cond, 0), g.ref(cond, 1), g.ref(cond, 2)
        else:
            enc = g.add(
                "VAEEncodeForInpaint",
                {
                    "pixels": g.ref(img, 0),
                    "vae": vae,
                    "mask": g.ref(mask, 0),
                    "grow_mask_by": int(spec.get("inpaint_grow") or 6),
                },
                "VAEEncodeForInpaint",
            )
            positive, negative, latent = g.ref(pos, 0), g.ref(neg, 0), g.ref(enc, 0)
        if denoise >= 0.999:
            warnings.append("Inpaint с denoise 1 перегенерирует маску почти с нуля. Для правки обычно 0.4–0.85.")
        _save(g, g.ref(_sampler(g, spec, model, positive, negative, latent, denoise), 0), vae, spec.get("filename_prefix") or "studio/gen")
        return g.nodes

    if has_image and denoise < 0.999:
        img = _load_image(g, spec["image"], "Crop")
        enc = g.add("VAEEncode", {"pixels": g.ref(img, 0), "vae": vae}, "VAEEncode")
        _save(
            g,
            g.ref(_sampler(g, spec, model, g.ref(pos, 0), g.ref(neg, 0), g.ref(enc, 0), denoise), 0),
            vae,
            spec.get("filename_prefix") or "studio/gen",
        )
        return g.nodes

    latent_cls, latent_inputs, _ = _latent_node(spec, w, h, batch)
    latent = g.add(latent_cls, latent_inputs, latent_cls)
    _save(
        g,
        g.ref(_sampler(g, spec, model, g.ref(pos, 0), g.ref(neg, 0), g.ref(latent, 0), 1.0), 0),
        vae,
        spec.get("filename_prefix") or "studio/gen",
    )
    return g.nodes


def _build_qwen(g, spec, warnings, model, clip, vae, prompt, negative, include_image: bool) -> dict:
    res = int(spec.get("qwen_resolution") or spec.get("width") or 1024)
    res = snap(res, 32, minimum=32)
    if res == 1024 and include_image:
        warnings.append(
            "Qwen Image 2.1: при resolution=1024 и подключённом VAE известен шум на референсах "
            "(ComfyUI issue #16435). Если результат — шум, поставьте 992 или 1056."
        )
    inputs: dict[str, Any] = {
        "clip": clip,
        "vae": vae,
        "prompt": prompt,
        "negative_prompt": negative,
        "resolution": res,
    }
    index = 1
    if include_image and spec.get("image"):
        img = _load_image(g, spec["image"], "Edit image")
        inputs[f"images.image_{index}"] = g.ref(img, 0)
        index += 1
    for i, ref in enumerate(spec.get("references") or []):
        if not ref or index > 16:
            break
        node = _load_image(g, ref, f"Reference {i + 1}")
        inputs[f"images.image_{index}"] = g.ref(node, 0)
        index += 1
    if include_image and "images.image_1" not in inputs:
        raise WorkflowError("Редактирование Qwen Image 2.1 требует изображение области.")
    enc = g.add("TextEncodeQwenImage21", inputs, "TextEncodeQwenImage21")
    denoise = float(spec.get("denoise") if spec.get("denoise") is not None else 1.0)
    # The node returns the latent that matches the reference. Sampling any other size shifts the edit.
    _save(
        g,
        g.ref(_sampler(g, spec, model, g.ref(enc, 0), g.ref(enc, 1), g.ref(enc, 2), denoise if include_image else 1.0), 0),
        vae,
        spec.get("filename_prefix") or "studio/gen",
    )
    return g.nodes


def build_krea_edit(spec: dict, warnings: list[str]) -> dict:
    g = _Graph()
    model, clip, vae = _add_loaders(g, spec)
    if not _enabled_loras(spec):
        warnings.append(
            "Krea 2 Edit обучен как LoRA (krea2_identity_edit_v2 или krea2_general_edit_v2). "
            "Без неё ноды отработают, но идентичность и инструкция почти не держатся."
        )
    prompt = spec.get("final_prompt")
    if prompt is None:
        prompt = assemble_prompt(spec.get("prompt") or "", spec.get("prompt_presets"), spec.get("loras"))
    negative = spec.get("negative") or ""
    if not spec.get("image"):
        raise WorkflowError("Редактирование Krea 2 требует кроп области (исходное изображение).")

    krea = spec.get("krea") or {}
    impl = krea.get("impl") or "internal"
    if impl == "external":
        patch_cls = "Krea2EditModelPatch"
        enc_cls = "Krea2EditGroundedEncode"
    else:
        patch_cls = "StudioKrea2EditModelPatch"
        enc_cls = "StudioKrea2EditGroundedEncode"

    w, h, batch = _size(spec, 16)
    src = _load_image(g, spec["image"], "Source")
    refs = [r for r in (spec.get("references") or []) if r]
    ref_node = _load_image(g, refs[0], "Reference") if refs else None
    if len(refs) > 1:
        warnings.append("Krea 2 Edit в этой версии принимает исходник и один дополнительный референс (image_b). Лишние референсы не отправлены.")

    latent = g.add(
        "EmptySD3LatentImage",
        {"width": w, "height": h, "batch_size": batch},
        "EmptySD3LatentImage",
    )
    grounding = int(krea.get("grounding_px") if krea.get("grounding_px") is not None else 768)
    fit_mode = krea.get("fit_mode") or "fit"
    if fit_mode not in ("fit", "crop (legacy)"):
        fit_mode = "fit"

    def _enc(text: str, title: str) -> str:
        inputs = {
            "clip": clip,
            "prompt": text,
            "image": g.ref(src, 0),
            "grounding_px": grounding,
        }
        if ref_node:
            inputs["image_b"] = g.ref(ref_node, 0)
        return g.add(enc_cls, inputs, title)

    pos = _enc(prompt, "Grounded positive")
    # At CFG > 1 the negative must be grounded on the same image (trained unconditional).
    neg = _enc(negative, "Grounded negative")

    src_lat = g.add("VAEEncode", {"pixels": g.ref(src, 0), "vae": vae}, "Source latent")
    patch_inputs: dict[str, Any] = {
        "model": model,
        "source_latent": g.ref(src_lat, 0),
        "vae": vae,
        "source_image": g.ref(src, 0),
        "target_latent": g.ref(latent, 0),
        "fit_mode": fit_mode,
        "ref_boost": float(krea.get("ref_boost") if krea.get("ref_boost") is not None else 1.0),
        "ref_boost_a": float(krea.get("ref_boost_a") if krea.get("ref_boost_a") is not None else 1.0),
        "ref_position": krea.get("ref_position") or "aligned (trained)",
        "ref_position_a": krea.get("ref_position_a") or "aligned (trained)",
    }
    if ref_node:
        src_lat_b = g.add("VAEEncode", {"pixels": g.ref(ref_node, 0), "vae": vae}, "Reference latent")
        patch_inputs["source_latent_b"] = g.ref(src_lat_b, 0)
        patch_inputs["source_image_b"] = g.ref(ref_node, 0)
    patched = g.add(patch_cls, patch_inputs, "Krea2EditModelPatch")

    denoise = float(spec.get("denoise") if spec.get("denoise") is not None else 1.0)
    if denoise < 0.999:
        warnings.append("Krea 2 Edit семплирует чистый шум, обусловленный исходником. Denoise принудительно 1; локальность даёт маска вклейки.")
        denoise = 1.0
    _save(
        g,
        g.ref(_sampler(g, spec, g.ref(patched, 0), g.ref(pos, 0), g.ref(neg, 0), g.ref(latent, 0), denoise), 0),
        vae,
        spec.get("filename_prefix") or "studio/gen",
    )
    return g.nodes


def build_workflow(spec: dict) -> tuple[dict, list[str], str]:
    """Return (api prompt, warnings, pipeline id actually built)."""
    if not isinstance(spec, dict):
        raise WorkflowError("Пустой запрос.")
    warnings: list[str] = []
    pipeline = spec.get("pipeline") or "create"
    if pipeline == "edit":
        method = spec.get("edit_method") or "inpaint"
        if method == "krea2_edit":
            return build_krea_edit(spec, warnings), warnings, "edit:krea2_edit"
        if method in ("qwen_image_21", "qwen"):
            g = _Graph()
            model, clip, vae = _add_loaders(g, spec)
            prompt = spec.get("final_prompt")
            if prompt is None:
                prompt = assemble_prompt(spec.get("prompt") or "", spec.get("prompt_presets"), spec.get("loras"))
            nodes = _build_qwen(
                g, spec, warnings, model, clip, vae, prompt, spec.get("negative") or "", include_image=True
            )
            return nodes, warnings, "edit:qwen_image_21"
        if method == "qwen_image":
            return _build_qwen_legacy(spec, warnings), warnings, "edit:qwen_image"
        # generic inpaint / img2img — same code as create, but an image is required
        if not spec.get("image"):
            raise WorkflowError("Редактирование требует изображение на холсте.")
        edited = dict(spec)
        edited["pipeline"] = "create"
        if spec.get("has_mask"):
            edited["has_mask"] = True
        else:
            # no painted mask: img2img the crop, default denoise if the user left it at 1
            edited["has_mask"] = False
            if float(edited.get("denoise") or 1) >= 0.999:
                edited["denoise"] = 0.75
                warnings.append("Маска не нарисована — область уходит в img2img с denoise 0.75. Нарисуйте маску для inpaint или оставьте denoise ниже 1.")
        return build_create(edited, warnings), warnings, "edit:inpaint"
    return build_create(spec, warnings), warnings, "create"


def _build_qwen_legacy(spec: dict, warnings: list[str]) -> dict:
    """Older core node TextEncodeQwenImageEdit (Qwen Image Edit, not 2.1)."""
    g = _Graph()
    model, clip, vae = _add_loaders(g, spec)
    if not spec.get("image"):
        raise WorkflowError("Qwen Image Edit требует изображение.")
    prompt = spec.get("final_prompt")
    if prompt is None:
        prompt = assemble_prompt(spec.get("prompt") or "", spec.get("prompt_presets"), spec.get("loras"))
    negative = spec.get("negative") or ""
    img = _load_image(g, spec["image"], "Edit image")
    pos = g.add(
        "TextEncodeQwenImageEdit",
        {"clip": clip, "prompt": prompt, "vae": vae, "image": g.ref(img, 0)},
        "Qwen edit positive",
    )
    neg = g.add(
        "TextEncodeQwenImageEdit",
        {"clip": clip, "prompt": negative, "vae": vae, "image": g.ref(img, 0)},
        "Qwen edit negative",
    )
    w, h, batch = _size(spec, 16)
    latent = g.add("EmptySD3LatentImage", {"width": w, "height": h, "batch_size": batch}, "Latent")
    warnings.append("TextEncodeQwenImageEdit — это прежний Qwen Image Edit, не 2.1. Для 2.1 выберите способ qwen_image_21.")
    _save(
        g,
        g.ref(_sampler(g, spec, model, g.ref(pos, 0), g.ref(neg, 0), g.ref(latent, 0), 1.0), 0),
        vae,
        spec.get("filename_prefix") or "studio/gen",
    )
    return g.nodes


def adapt_to_installed(prompt: dict) -> list[str]:
    """Drop inputs the installed node does not declare. Keep autogrow keys (images.image_N).

    Returns a list of human-readable notes. Raises WorkflowError if a class is missing.
    """
    import nodes

    notes: list[str] = []
    missing = []
    for nid, node in prompt.items():
        cls_name = node.get("class_type")
        cls = nodes.NODE_CLASS_MAPPINGS.get(cls_name)
        if cls is None:
            missing.append(cls_name or "?")
            continue
        try:
            spec = cls.INPUT_TYPES()
        except Exception as exc:  # node list may touch the filesystem
            notes.append(f"{cls_name}: не удалось прочитать INPUT_TYPES ({exc}).")
            continue
        allowed: set[str] = set()
        for section in ("required", "optional", "hidden"):
            allowed.update((spec.get(section) or {}).keys())
        for key in list(node.get("inputs") or {}):
            if key in allowed or "." in key or key.startswith("image"):
                continue
            node["inputs"].pop(key, None)
            notes.append(f"{cls_name}: вход «{key}» убран — его нет в этой версии ComfyUI.")
    if missing:
        uniq = sorted(set(missing))
        raise WorkflowError(
            "В этой версии ComfyUI нет нод: "
            + ", ".join(uniq)
            + ". Обновите ComfyUI (Qwen Image 2.1 — с версии 0.37) или смените способ редактирования."
        )
    return notes


def describe_pipeline(spec: dict, built: str) -> list[dict]:
    """Short Russian labels for the graph strip in the studio header."""
    loader = "Checkpoint" if (spec.get("loader") == "checkpoint") else "UNET + CLIP + VAE"
    loras = _enabled_loras(spec)
    lora_label = f"LoRA ×{len(loras)}" if loras else "без LoRA"
    steps = spec.get("steps") or "?"
    cfg = spec.get("cfg")
    if built.startswith("edit:krea2"):
        tail = "Krea2 Edit → бесшовная вклейка"
    elif built.startswith("edit:qwen_image_21"):
        tail = "Qwen Image 2.1 → бесшовная вклейка"
    elif built.startswith("edit:qwen"):
        tail = "Qwen Image Edit → бесшовная вклейка"
    elif built.startswith("edit:"):
        tail = "Inpaint → бесшовная вклейка"
    elif spec.get("has_mask") and spec.get("image"):
        tail = "Inpaint маски → новый слой"
    else:
        tail = "Сэмплинг в область → новый слой"
    return [
        {"text": f"Область {spec.get('width')}×{spec.get('height')}", "color": "#4aa8ff"},
        {"text": loader, "color": "#ff7a1a"},
        {"text": lora_label, "color": "#b18cff"},
        {"text": "Промт + пресеты", "color": "#e7c27a"},
        {"text": f"KSampler · {steps} / {cfg}", "color": "#3ddc97"},
        {"text": tail, "color": "#ff5c7a"},
    ]
