# ZeroImageStudio

ZeroImageStudio is an open-source ComfyUI node that opens a full-page image editor in the browser. You paint a region, generate or edit inside it, and the result comes back as its own layer. The collapsed node returns the flattened image, the mask, and a JSON description of the layers.

The interface is in Russian. There are two pipelines, and neither one is hard-wired to a single checkpoint:

- **Создание** (create) is one generic graph: a checkpoint or a diffusion model plus text encoder and VAE, LoRAs, and a sampler. The same code path covers text-to-image, img2img, and inpaint.
- **Редактирование** (edit) crops the generation area, runs an edit, and pastes the crop back. Krea 2 Edit is built in. Qwen Image 2.1 Edit uses ComfyUI’s own nodes.

No third-party custom-node packs are required.

![Editor](docs/editor.png)

The create pipeline uses the same panels. Switch it with **Создание** in the model column.

![Create pipeline](docs/create.png)

## Install

You need a ComfyUI build that already knows Krea 2 and Qwen Image 2.1. Qwen Image 2.1 landed in ComfyUI 0.37; this package was checked against 0.42.

```bash
cd ComfyUI/custom_nodes
git clone <this repository> ComfyUI-ZeroImageStudio
# restart ComfyUI
```

The folder name matters: ComfyUI serves the editor from `/extensions/ComfyUI-ZeroImageStudio/`.

In the graph, add **ZeroImageStudio — редактор изображений** and press **Развернуть ZeroImageStudio**. Esc, or **Свернуть в ноду**, writes the flattened frame back to the node outputs `IMAGE`, `MASK`, and `LAYERS`.

**ZeroImageStudio — загрузчик моделей** is optional. The editor reads ComfyUI’s model folders itself and queues a separate prompt for each generation. Use the loader only when you want `MODEL`, `CLIP`, and `VAE` sockets in the graph.

## Requirements

Nothing extra to pip-install. ComfyUI already provides `torch`, `numpy`, `Pillow`, `einops`, and `aiohttp`.

Weights are not in this repository. Put them in the usual ComfyUI folders and pick the files in the editor. The hints in `hints/models.json` only suggest names:

| Hint | Typical files |
| --- | --- |
| Krea 2 | `krea2_turbo_fp8_scaled.safetensors`, CLIP `qwen3vl_4b_fp8_scaled.safetensors` with type `krea2`, VAE `qwen_image_vae.safetensors` |
| Krea 2 Identity Edit 2.0 | the same, plus one LoRA: `krea2_identity_edit_v2.safetensors` or `krea2_general_edit_v2.safetensors` |
| Qwen Image 2.1 Edit | a Qwen Image 2.1 UNET, CLIP type `qwen_image`, and the matching VAE |

A Civitai API token and an OpenAI-compatible LLM (Ollama, llama.cpp, LM Studio) are optional. Both are saved under ComfyUI’s user directory (`user/zeroimagestudio/settings.json`), not in this repo. Leave them blank and those buttons report that they are not configured.

## How a generation is built

Create, and the generic inpaint edit, assemble core nodes only: `CheckpointLoaderSimple` or `UNETLoader` + `CLIPLoader` + `VAELoader`, then `LoraLoader`, `CLIPTextEncode` or `TextEncodeQwenImage21`, an empty latent or a VAE encode, `KSampler`, `VAEDecode`, `SaveImage`.

Edit methods:

| Method | Graph |
| --- | --- |
| Inpaint / img2img | Same as create. A painted mask uses `VAEEncodeForInpaint` or `InpaintModelConditioning`. With no mask, the crop is img2img; denoise falls back to 0.75 if you left it at 1. |
| Krea 2 Edit | `ZeroImageStudioKrea2EditModelPatch` and `ZeroImageStudioKrea2EditGroundedEncode`. |
| Qwen Image 2.1 | Core `TextEncodeQwenImage21`, slots `images.image_1` … `images.image_16`. |
| Older Qwen Image Edit | Core `TextEncodeQwenImageEdit`. This is not 2.1. |

The paste-back is NumPy: a feather, a hard mask, or a coarse-to-fine Jacobi Poisson blend, plus an optional Reinhard color match on the mask border. The original layer stays underneath.

## Krea 2 Edit

The edit forward is derived from [lbouaraba/comfyui-krea2edit](https://github.com/lbouaraba/comfyui-krea2edit) v2.0.0 (commit `13ef60f`, Apache-2.0). See [that README](https://github.com/lbouaraba/comfyui-krea2edit/blob/v2.0.0/README.md), the example [workflow](https://github.com/lbouaraba/comfyui-krea2edit/blob/v2.0.0/workflows/krea2_identity_edit.json), and `NOTICE`.

What the two nodes do:

1. **Model patch.** The VAE latent of the source (and one optional second reference) is prepended to `SingleStreamDiT` as RoPE frames 1 and 2. `fit` resamples the picture in pixel space onto the output grid. Connect VAE, source image, and the same latent the sampler uses so the encode happens before sampling.
2. **Grounded encode.** The instruction is tokenized with the picture through the Qwen3-VL template (`<|vision_start|><|image_pad|><|vision_end|>` plus the text). At CFG above 1 the negative is grounded on the same image with an empty prompt. `grounding_px` caps the long side sent to the vision encoder (768 by default; 1024 is a common choice for faces).

Both nodes are required. A plain `CLIPTextEncode` does not match how the LoRA was trained.

The upstream example workflow uses 1024×1024, euler / simple, CFG 1, 10 steps, and grounding 768. The README there also describes a fast Turbo path of about 8 steps at CFG 1, and a Raw model at CFG around 3 and about 20 steps when the edit has to remove something. Denoise inside this editor is forced to 1 for Krea; the mask is what keeps the edit local. One extra reference image is sent. Further references are ignored.

In **Параметры графа** you can point the same pipeline at an installed copy of `comfyui-krea2edit` instead of the embedded nodes.

## Qwen Image 2.1

`TextEncodeQwenImage21` returns the latent that matches the first reference. Sampling any other size shifts the edit. At `resolution` 1024 with a VAE connected, ComfyUI has a known noisy-reference bug ([issue #16435](https://github.com/Comfy-Org/ComfyUI/issues/16435)). The editor warns and suggests 992 or 1056. Refer to pictures in the prompt as `<image1>`, `<image2>`, and so on. Up to 16 references are passed through.

## Editor

- Move, marquee, lasso, scale, crop, brush, eraser, eyedropper, mask, generation area, hand, zoom. Wheel zooms, space pans, `[` and `]` change the brush.
- The generation rectangle sets the output size, aspect lock, context padding, and paste mode.
- Layers have visibility, lock, opacity, blend mode, duplicate, delete, and drag-to-reorder. Undo and redo keep 20 steps.
- References come from a file or from the active layer.
- The gallery writes PNG files under `output/zeroimagestudio/gallery` with prompt, seed, model, and LoRA metadata. **Применить заново** fills the settings and does not start a job.
- **Сохранить** writes the project under `user/zeroimagestudio/projects` and downloads a zip.
- Generation presets store the model, LoRAs, sampler, and area, not the canvas pixels. Prompt presets are wrapped around the text only when the job is queued.
- The LoRA list is the `models/loras` tree. **Civitai info** hashes the file and reads the public model-version API. Trigger words can be inserted at the start, at the end, or not at all.
- The LLM buttons call an OpenAI-compatible `/chat/completions` endpoint: improve, extend, or describe the canvas.

Each run is a normal ComfyUI `/prompt`. Pressing generate again while one is running calls `/interrupt`.

## Adding a model

Add an object to `hints/models.json`. Set `pipeline` to `create` or `edit`, and for an edit set `edit_method` to `inpaint`, `krea2_edit`, `qwen_image_21`, or `qwen_image`. `defaults` are file names. `sampler` and `output` are optional. The graph builders do not need a change.

## Development

```bash
python -m unittest discover -s tests
```

The tests cover prompt assembly, both pipelines’ API graphs, and the paste-back. They do not need Torch or a running ComfyUI.

## Contributing

Issues and pull requests are welcome.

- Keep the two pipelines generic. A new model should be a hint and a preset, not a new code path, unless it needs a node ComfyUI does not ship.
- Do not add a dependency on another custom-node pack. If you vendor something, keep its license and add the attribution to `NOTICE`.
- UI strings are Russian.
- Do not commit API keys, model weights, or machine-local paths. Settings belong in ComfyUI’s user directory.

## License

Apache License 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).

`zeroimagestudio_krea2edit.py` is derived from comfyui-krea2edit v2.0.0, also Apache-2.0. The Krea edit weights are not part of this repository and stay under their own license.
