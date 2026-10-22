"""HTTP routes under /zeroimagestudio. Registered on ComfyUI's PromptServer."""

from __future__ import annotations

import asyncio
import io
import json
import os
import urllib.error
import urllib.request
from urllib.parse import urlparse

from aiohttp import web

try:
    from . import zeroimagestudio_paste
    from . import zeroimagestudio_storage as store
    from . import zeroimagestudio_workflows as wf
except ImportError:
    import zeroimagestudio_paste
    import zeroimagestudio_storage as store
    import zeroimagestudio_workflows as wf

KREA_IMPORT_ERROR = None
HINTS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "hints", "models.json")


def _json(data, status=200):
    return web.json_response(data, status=status, dumps=lambda o: json.dumps(o, ensure_ascii=False))


async def _body(request: web.Request) -> dict:
    if request.content_type and "json" in request.content_type:
        data = await request.json()
        return data if isinstance(data, dict) else {}
    return {}


def _hints() -> list:
    try:
        with open(HINTS_PATH, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception as exc:
        return [{"id": "error", "name": f"hints: {exc}", "pipeline": "create"}]


def _model_lists() -> dict:
    import comfy.samplers
    import nodes

    import folder_paths

    def files(folder):
        try:
            return list(folder_paths.get_filename_list(folder))
        except Exception:
            return []

    def combo(class_name, key, section="required"):
        cls = nodes.NODE_CLASS_MAPPINGS.get(class_name)
        if cls is None:
            return []
        try:
            spec = cls.INPUT_TYPES().get(section) or {}
        except Exception:
            return []
        raw = spec.get(key)
        if isinstance(raw, (list, tuple)) and raw:
            opts = raw[0]
            if isinstance(opts, (list, tuple)):
                return list(opts)
        return []

    return {
        "checkpoints": files("checkpoints"),
        "unets": files("diffusion_models"),
        "clips": files("text_encoders"),
        "vaes": files("vae"),
        "loras": files("loras"),
        "clip_types": combo("CLIPLoader", "type") or ["stable_diffusion", "krea2", "qwen_image"],
        "weight_dtypes": combo("UNETLoader", "weight_dtype")
        or ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"],
        "samplers": list(comfy.samplers.KSampler.SAMPLERS),
        "schedulers": list(comfy.samplers.KSampler.SCHEDULERS),
        "krea_import_error": KREA_IMPORT_ERROR,
    }


def _lora_tree(names: list[str]) -> dict:
    """Group on forward slashes. The file entry stays the name ComfyUI returned."""
    root: dict = {"name": "", "path": "", "children": {}, "files": []}
    for name in names:
        normalized = str(name).replace("\\", "/")
        parts = [part for part in normalized.split("/") if part]
        if not parts:
            continue
        node = root
        for folder in parts[:-1]:
            node = node["children"].setdefault(folder, {"name": folder, "path": "", "children": {}, "files": []})
        node["files"].append(name)

    def walk(node, prefix):
        node["path"] = prefix
        for child_name, child in node["children"].items():
            child_prefix = f"{prefix}/{child_name}" if prefix else child_name
            walk(child, child_prefix)

    walk(root, "")
    return root


def _resolve_lora(name: str) -> str:
    import folder_paths

    path = folder_paths.get_full_path("loras", name)
    if not path or not os.path.isfile(path):
        raise web.HTTPNotFound(text=f"LoRA не найден: {name}")
    return path


async def health(_request):
    version = "unknown"
    try:
        import comfyui_version

        version = getattr(comfyui_version, "__version__", None) or str(comfyui_version)
    except Exception:
        pass
    return _json({"ok": True, "comfyui": version, "krea_import_error": KREA_IMPORT_ERROR, "package": "comfyui-zeroimagestudio"})


async def hints(_request):
    return _json({"hints": _hints()})


async def models(_request):
    return _json(_model_lists())


async def lora_tree(_request):
    data = _model_lists()
    return _json({"files": data["loras"], "tree": _lora_tree(data["loras"])})


async def lora_hash(request):
    body = await _body(request)
    name = (body.get("name") or "").strip()
    if not name:
        return _json({"error": "Не указано имя LoRA."}, 400)
    path = _resolve_lora(name)
    loop = asyncio.get_running_loop()
    digest = await loop.run_in_executor(None, store.cached_sha256, path)
    return _json({"name": name, "sha256": digest, "bytes": os.path.getsize(path)})


def _civitai_summarize(payload: dict) -> dict:
    model = payload.get("model") or {}
    files = payload.get("files") or []
    size = None
    if files:
        size = files[0].get("sizeKB")
    stats = payload.get("stats") or {}
    words = payload.get("trainedWords") or []
    preview = None
    for img in payload.get("images") or []:
        if not isinstance(img, dict):
            continue
        flag = img.get("nsfw")
        level = img.get("nsfwLevel")
        allowed = flag in (None, False, "None", "Soft", "none", "soft") and level in (None, 0, 1, 2, "None", "Soft")
        if allowed and img.get("url"):
            preview = img.get("url")
            break
    return {
        "id": payload.get("id"),
        "model_id": model.get("id") or payload.get("modelId"),
        "name": payload.get("name") or model.get("name"),
        "model_name": model.get("name"),
        "base_model": payload.get("baseModel"),
        "description": (payload.get("description") or "")[:2000],
        "trained_words": words,
        "air": payload.get("air"),
        "download_count": stats.get("downloadCount"),
        "rating": stats.get("rating"),
        "size_kb": size,
        "preview": preview,
        "url": f"https://civitai.com/models/{model.get('id') or payload.get('modelId')}" if (model.get("id") or payload.get("modelId")) else None,
        "version_url": f"https://civitai.com/models/{model.get('id') or payload.get('modelId')}?modelVersionId={payload.get('id')}" if payload.get("id") else None,
    }


async def lora_civitai(request):
    body = await _body(request)
    name = (body.get("name") or request.query.get("name") or "").strip()
    digest = (body.get("sha256") or request.query.get("sha256") or "").strip().lower()
    if name and not digest:
        path = _resolve_lora(name)
        loop = asyncio.get_running_loop()
        digest = await loop.run_in_executor(None, store.cached_sha256, path)
    if not digest:
        return _json({"error": "Нет хеша и нет имени файла."}, 400)
    cached = store.civitai_get(digest)
    if cached:
        return _json({"sha256": digest, "cached": True, "info": cached})
    settings = store.load_settings()
    url = f"https://civitai.com/api/v1/model-versions/by-hash/{digest}"
    headers = {"User-Agent": "comfyui-zeroimagestudio", "Accept": "application/json"}
    token = (settings.get("civitai_token") or "").strip()
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, headers=headers)

    def fetch():
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()

    loop = asyncio.get_running_loop()
    status, raw = await loop.run_in_executor(None, fetch)
    if status == 404:
        return _json({"sha256": digest, "info": None, "error": "Civitai не знает этот хеш."}, 404)
    if status >= 400:
        text = raw.decode("utf-8", "replace")[:500]
        return _json({"sha256": digest, "error": f"Civitai ответил {status}: {text}"}, 502)
    try:
        payload = json.loads(raw.decode("utf-8"))
    except Exception:
        return _json({"error": "Civitai вернул не JSON."}, 502)
    info = _civitai_summarize(payload if isinstance(payload, dict) else {})
    store.civitai_put(digest, info)
    return _json({"sha256": digest, "cached": False, "info": info})


async def get_settings(_request):
    return _json(store.public_settings())


async def post_settings(request):
    body = await _body(request)
    return _json(store.save_settings(body))


async def list_presets(request):
    kind = request.match_info.get("kind", "presets")
    if kind not in ("presets", "prompt_presets"):
        return _json({"error": "Неизвестная коллекция."}, 404)
    return _json({"items": store.list_named(kind)})


async def save_preset(request):
    kind = request.match_info.get("kind", "presets")
    if kind not in ("presets", "prompt_presets"):
        return _json({"error": "Неизвестная коллекция."}, 404)
    body = await _body(request)
    if not (body.get("name") or "").strip():
        return _json({"error": "У пресета нет имени."}, 400)
    return _json(store.save_named(kind, body))


async def delete_preset(request):
    kind = request.match_info.get("kind", "presets")
    item_id = request.match_info.get("item_id", "")
    if kind not in ("presets", "prompt_presets"):
        return _json({"error": "Неизвестная коллекция."}, 404)
    store.delete_named(kind, item_id)
    return _json({"ok": True})


async def build_workflow(request):
    spec = await _body(request)
    try:
        prompt, warnings, built = wf.build_workflow(spec)
        notes = wf.adapt_to_installed(prompt)
    except wf.WorkflowError as exc:
        return _json({"error": str(exc)}, 400)
    except Exception as exc:
        return _json({"error": f"{type(exc).__name__}: {exc}"}, 500)
    final_prompt = spec.get("final_prompt")
    if final_prompt is None:
        final_prompt = wf.assemble_prompt(spec.get("prompt") or "", spec.get("prompt_presets"), spec.get("loras"))
    return _json(
        {
            "workflow": prompt,
            "warnings": warnings + notes,
            "built": built,
            "final_prompt": final_prompt,
            "pipe": wf.describe_pipeline(spec, built),
        }
    )


async def assemble(request):
    spec = await _body(request)
    text = wf.assemble_prompt(spec.get("prompt") or "", spec.get("prompt_presets"), spec.get("loras"))
    return _json({"prompt": text})


async def paste(request):
    data = await request.post()
    try:
        result = _file_bytes(data, "result")
        original = _file_bytes(data, "original")
        mask = _file_bytes(data, "mask")
    except Exception as exc:
        return _json({"error": str(exc)}, 400)
    mode = str(data.get("mode") or "feather")
    raw_feather = data.get("feather")
    try:
        feather = 48 if raw_feather is None or raw_feather == "" else int(raw_feather)
    except Exception:
        feather = 48
    color = str(data.get("color_match") if data.get("color_match") not in (None, "") else "1") not in ("0", "false", "False")

    def _paste_job():
        from PIL import Image

        out = zeroimagestudio_paste.paste(
            Image.open(io.BytesIO(result)),
            Image.open(io.BytesIO(original)),
            Image.open(io.BytesIO(mask)),
            mode=mode,
            feather=feather,
            color=color,
        )
        buf = io.BytesIO()
        out.save(buf, format="PNG")
        return buf.getvalue()

    try:
        loop = asyncio.get_running_loop()
        body = await loop.run_in_executor(None, _paste_job)
    except Exception as exc:
        return _json({"error": f"Вклейка не удалась: {exc}"}, 500)
    return web.Response(body=body, content_type="image/png")


def _file_bytes(data, key: str) -> bytes:
    item = data.get(key)
    if item is None:
        raise ValueError(f"Нет файла «{key}».")
    if hasattr(item, "file"):
        item.file.seek(0)
        return item.file.read()
    if isinstance(item, (bytes, bytearray)):
        return bytes(item)
    raise ValueError(f"Поле «{key}» не файл.")


async def commit(request):
    data = await request.post()
    image = _file_bytes(data, "image")
    mask = None
    if data.get("mask"):
        try:
            mask = _file_bytes(data, "mask")
        except Exception:
            mask = None
    meta = {}
    raw = data.get("meta")
    if isinstance(raw, str) and raw.strip():
        try:
            meta = json.loads(raw)
        except Exception:
            meta = {"raw": raw[:500]}
    payload = meta if isinstance(meta, dict) else {}
    loop = asyncio.get_running_loop()
    saved = await loop.run_in_executor(None, store.commit_image, image, mask, payload)
    return _json(saved)


async def gallery_list(request):
    raw_offset = request.query.get("offset")
    raw_limit = request.query.get("limit")
    try:
        offset = 0 if raw_offset in (None, "") else int(raw_offset)
    except (TypeError, ValueError):
        offset = 0
    try:
        limit = store.GALLERY_PAGE if raw_limit in (None, "") else int(raw_limit)
    except (TypeError, ValueError):
        limit = store.GALLERY_PAGE
    loop = asyncio.get_running_loop()
    page = await loop.run_in_executor(None, lambda: store.list_gallery(offset, limit))
    return _json(page)


async def asset_list(_request):
    return _json({"items": store.list_assets()})


async def asset_save(request):
    data = await request.post()
    blob = _file_bytes(data, "file")
    upload = data.get("file")
    name = getattr(upload, "filename", "") or ""
    mime = getattr(upload, "content_type", "") or ""
    role = str(data.get("role") or "")
    if role not in ("canvas", "reference"):
        role = ""
    project_id = str(data.get("project_id") or "")
    imported = None
    raw = data.get("import")
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = json.loads(raw)
            imported = parsed if isinstance(parsed, dict) else None
        except Exception:
            imported = None
    loop = asyncio.get_running_loop()
    saved = await loop.run_in_executor(
        None, lambda: store.save_asset(blob, name, mime, role, project_id or None, imported)
    )
    return _json(saved)


async def asset_file(request):
    path = store.asset_path(request.match_info.get("asset_id", ""))
    if not path:
        return _json({"error": "Ассет не найден."}, 404)
    return web.FileResponse(path)


async def asset_thumb(request):
    path = store.asset_path(request.match_info.get("asset_id", ""), thumb=True)
    if not path:
        return _json({"error": "Превью не найдено."}, 404)
    return web.FileResponse(path)


async def asset_delete(request):
    store.delete_asset(request.match_info.get("asset_id", ""))
    return _json({"ok": True})


async def gallery_save(request):
    data = await request.post()
    image = _file_bytes(data, "image")
    meta = {}
    raw = data.get("meta")
    if isinstance(raw, str) and raw.strip():
        meta = json.loads(raw)
    if not isinstance(meta, dict):
        meta = {}
    loop = asyncio.get_running_loop()
    saved = await loop.run_in_executor(None, store.save_gallery_image, image, meta)
    return _json(saved)


async def project_put(request):
    project_id = request.match_info.get("project_id") or store.new_id()
    if not store.valid_project_id(project_id):
        return _json({"error": "Некорректный идентификатор проекта."}, 400)
    data = await request.post()
    raw = data.get("meta")
    if not isinstance(raw, str):
        return _json({"error": "Нет meta."}, 400)
    meta = json.loads(raw)
    files = {}
    for key, item in data.items():
        if key == "meta":
            continue
        if hasattr(item, "file"):
            name = key.replace("\\", "/")
            item.file.seek(0)
            files[name] = item.file.read()
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(None, lambda: store.save_project_files(project_id, meta, files))
    return _json({"id": project_id})


async def project_get(request):
    project_id = request.match_info["project_id"]
    if not store.valid_project_id(project_id):
        return _json({"error": "Некорректный идентификатор проекта."}, 400)
    try:
        meta = store.load_project_meta(project_id)
    except Exception as exc:
        return _json({"error": str(exc)}, 404)
    if not meta:
        return _json({"error": "Проект не найден."}, 404)
    return _json({"id": project_id, "meta": meta})


async def project_file(request):
    project_id = request.match_info["project_id"]
    if not store.valid_project_id(project_id):
        return _json({"error": "Некорректный идентификатор проекта."}, 400)
    name = request.match_info["name"]
    # name may contain slashes encoded; aiohttp {name:.*}
    try:
        path = store.project_file(project_id, name)
    except Exception as exc:
        return _json({"error": str(exc)}, 400)
    if not os.path.isfile(path):
        return _json({"error": "Файл не найден."}, 404)
    return web.FileResponse(path)


async def project_export(request):
    project_id = request.match_info["project_id"]
    if not store.valid_project_id(project_id):
        return _json({"error": "Некорректный идентификатор проекта."}, 400)
    try:
        loop = asyncio.get_running_loop()
        blob = await loop.run_in_executor(None, store.export_project_zip, project_id)
    except Exception as exc:
        return _json({"error": str(exc)}, 400)
    return web.Response(
        body=blob,
        content_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="{project_id}.zeroimagestudio.zip"'},
    )


async def project_import(request):
    data = await request.post()
    blob = _file_bytes(data, "file")
    try:
        loop = asyncio.get_running_loop()
        project_id = await loop.run_in_executor(None, store.import_project_zip, blob)
    except Exception as exc:
        return _json({"error": str(exc)}, 400)
    return _json({"id": project_id, "meta": store.load_project_meta(project_id)})


def llm_base_url(value) -> str:
    """Settings only. http and https, never a scheme from the request body."""
    base = str(value or "").strip().rstrip("/")
    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return ""
    return base


async def llm(request):
    body = await _body(request)
    mode = body.get("mode") or "improve"
    settings = store.load_settings()
    base = llm_base_url(settings.get("llm_base"))
    model = (body.get("model") or settings.get("llm_model") or "").strip()
    key = body.get("api_key") if body.get("api_key") not in (None, "") else (settings.get("llm_key") or "")
    system = body.get("system")
    if not system:
        system = (settings.get("llm_systems") or {}).get(mode) or ""
    if not base:
        return _json({"error": "Не задан адрес OpenAI-совместимого API (Настройки → LLM)."}, 400)
    if not model:
        return _json({"error": "Не задано имя модели LLM."}, 400)
    user_text = body.get("prompt") or ""
    content: list | str
    images: list[str] = []
    raw_images = body.get("images")
    if isinstance(raw_images, list):
        images.extend(str(item) for item in raw_images if item)
    image = body.get("image")  # data URL or raw base64
    if isinstance(image, str) and image:
        images.insert(0, image)
    images = images[:4]
    normalized: list[str] = []
    for item in images:
        if not item.startswith("data:"):
            item = "data:image/png;base64," + item
        normalized.append(item)
    if normalized and mode in ("describe", "improve"):
        lead = user_text or ("Опиши изображение как промт." if mode == "describe" else "Улучши промт, опираясь на изображения.")
        content = [{"type": "text", "text": lead}]
        content.extend({"type": "image_url", "image_url": {"url": item}} for item in normalized)
    else:
        content = user_text
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": content},
        ],
        "temperature": 0.7 if body.get("temperature") is None or body.get("temperature") == "" else float(body.get("temperature")),
    }
    url = base + "/chat/completions"
    raw = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json", "Accept": "application/json"}
    if key:
        headers["Authorization"] = f"Bearer {key}"
    req = urllib.request.Request(url, data=raw, headers=headers, method="POST")

    def fetch():
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as exc:
            return exc.code, exc.read()
        except Exception as exc:
            return 0, str(exc).encode("utf-8")

    loop = asyncio.get_running_loop()
    status, raw_resp = await loop.run_in_executor(None, fetch)
    if status == 0:
        return _json({"error": "LLM недоступен: " + raw_resp.decode("utf-8", "replace")}, 502)
    if status >= 400:
        return _json({"error": f"LLM ответил {status}: {raw_resp.decode('utf-8', 'replace')[:800]}"}, 502)
    try:
        parsed = json.loads(raw_resp.decode("utf-8"))
        text = parsed["choices"][0]["message"]["content"]
    except Exception:
        return _json({"error": "Не удалось разобрать ответ LLM.", "raw": raw_resp.decode("utf-8", "replace")[:800]}, 502)
    if isinstance(text, list):
        text = "".join(part.get("text", "") if isinstance(part, dict) else str(part) for part in text)
    return _json({"text": str(text).strip(), "mode": mode})


def register(krea_import_error=None):
    global KREA_IMPORT_ERROR
    KREA_IMPORT_ERROR = krea_import_error
    from server import PromptServer

    routes = PromptServer.instance.routes
    app = PromptServer.instance.app
    # Projects with a few full-res layers are larger than aiohttp's 1 MiB default.
    if getattr(app, "_client_max_size", 0) < 512 * 1024 * 1024:
        app._client_max_size = 512 * 1024 * 1024

    def add(method, path, handler):
        routes.route(method, path)(handler)

    add("GET", "/zeroimagestudio/health", health)
    add("GET", "/zeroimagestudio/hints", hints)
    add("GET", "/zeroimagestudio/models", models)
    add("GET", "/zeroimagestudio/loras", lora_tree)
    add("POST", "/zeroimagestudio/loras/hash", lora_hash)
    add("POST", "/zeroimagestudio/loras/civitai", lora_civitai)
    add("GET", "/zeroimagestudio/settings", get_settings)
    add("POST", "/zeroimagestudio/settings", post_settings)
    add("GET", "/zeroimagestudio/collection/{kind}", list_presets)
    add("POST", "/zeroimagestudio/collection/{kind}", save_preset)
    add("DELETE", "/zeroimagestudio/collection/{kind}/{item_id}", delete_preset)
    add("POST", "/zeroimagestudio/build_workflow", build_workflow)
    add("POST", "/zeroimagestudio/assemble", assemble)
    add("POST", "/zeroimagestudio/paste", paste)
    add("POST", "/zeroimagestudio/commit", commit)
    add("GET", "/zeroimagestudio/gallery", gallery_list)
    add("POST", "/zeroimagestudio/gallery", gallery_save)
    add("GET", "/zeroimagestudio/assets", asset_list)
    add("POST", "/zeroimagestudio/assets", asset_save)
    add("GET", "/zeroimagestudio/assets/{asset_id}/file", asset_file)
    add("GET", "/zeroimagestudio/assets/{asset_id}/thumb", asset_thumb)
    add("DELETE", "/zeroimagestudio/assets/{asset_id}", asset_delete)
    add("POST", "/zeroimagestudio/project", project_put)
    add("POST", "/zeroimagestudio/project/{project_id}", project_put)
    add("GET", "/zeroimagestudio/project/{project_id}", project_get)
    add("GET", "/zeroimagestudio/project/{project_id}/file/{name:.+}", project_file)
    add("GET", "/zeroimagestudio/project/{project_id}/export", project_export)
    add("POST", "/zeroimagestudio/import_project", project_import)
    add("POST", "/zeroimagestudio/llm", llm)
