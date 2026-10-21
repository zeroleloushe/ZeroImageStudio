"""Graph nodes: ZeroImageStudio (the editor shell) and ZeroImageStudioModelLoader."""

from __future__ import annotations

import os

import numpy as np
import torch
from PIL import Image

import zeroimagestudio_storage as store


def _list(folder: str) -> list[str]:
    try:
        import folder_paths

        files = list(folder_paths.get_filename_list(folder))
    except Exception:
        files = []
    return files or ["(нет файлов)"]


def _clip_types() -> list[str]:
    try:
        import nodes

        spec = nodes.NODE_CLASS_MAPPINGS["CLIPLoader"].INPUT_TYPES()
        return list(spec["required"]["type"][0])
    except Exception:
        return ["stable_diffusion", "krea2", "qwen_image"]


def _dtypes() -> list[str]:
    return ["default", "fp8_e4m3fn", "fp8_e4m3fn_fast", "fp8_e5m2"]


def _load_rgba(path: str) -> Image.Image:
    return Image.open(path).convert("RGBA")


def _image_tensor(path: str) -> torch.Tensor:
    image = _load_rgba(path)
    arr = np.asarray(image, dtype=np.float32) / 255.0
    rgb = arr[..., :3]
    return torch.from_numpy(rgb).unsqueeze(0)


def _mask_tensor(path: str, fallback_hw: tuple[int, int]) -> torch.Tensor:
    if path and os.path.isfile(path):
        image = Image.open(path).convert("L")
        arr = np.asarray(image, dtype=np.float32) / 255.0
        return torch.from_numpy(arr).unsqueeze(0)
    h, w = fallback_hw
    return torch.zeros((1, h, w), dtype=torch.float32)


def _output_path(rel: str) -> str:
    import folder_paths

    if not rel:
        return ""
    return store.safe_join(folder_paths.get_output_directory(), rel)


class ZeroImageStudio:
    """Full-page editor. Execution returns the last committed composite."""

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "zeroimagestudio_image": ("STRING", {"default": "", "tooltip": "Служебное: файл сведённого холста. Заполняет ZeroImageStudio."}),
                "zeroimagestudio_mask": ("STRING", {"default": ""}),
                "zeroimagestudio_layers": ("STRING", {"default": "", "multiline": True}),
                "zeroimagestudio_project": ("STRING", {"default": ""}),
            },
            "optional": {
                "image": ("IMAGE", {"tooltip": "Необязательный входной кадр. Если редактор ещё ничего не сохранил, уходит на выход."}),
                "model": ("MODEL",),
                "clip": ("CLIP",),
                "vae": ("VAE",),
            },
        }

    RETURN_TYPES = ("IMAGE", "MASK", "STRING")
    RETURN_NAMES = ("IMAGE", "MASK", "LAYERS")
    FUNCTION = "run"
    CATEGORY = "ZeroImageStudio"
    DESCRIPTION = (
        "Редактор ZeroImageStudio. Кнопка «Развернуть ZeroImageStudio» открывает холст на весь браузер. "
        "Генерация и редактирование ставятся в очередь ComfyUI отдельными графами. "
        "Эта нода отдаёт последний сведённый кадр и маску."
    )

    def run(self, zeroimagestudio_image, zeroimagestudio_mask, zeroimagestudio_layers, zeroimagestudio_project, image=None, model=None, clip=None, vae=None):
        del model, clip, vae, zeroimagestudio_project
        layers = zeroimagestudio_layers or ""
        if zeroimagestudio_image:
            path = _output_path(zeroimagestudio_image)
            if os.path.isfile(path):
                tensor = _image_tensor(path)
                mask_path = _output_path(zeroimagestudio_mask) if zeroimagestudio_mask else ""
                mask = _mask_tensor(mask_path, (tensor.shape[1], tensor.shape[2]))
                if mask.shape[-2:] != tensor.shape[1:3]:
                    mask_img = Image.open(mask_path).convert("L").resize((tensor.shape[2], tensor.shape[1]), Image.Resampling.BILINEAR)
                    mask = torch.from_numpy(np.asarray(mask_img, dtype=np.float32) / 255.0).unsqueeze(0)
                return (tensor, mask, layers)
        if image is not None:
            b, h, w, _c = image.shape
            return (image, torch.zeros((b, h, w), dtype=torch.float32, device=image.device), layers)
        blank = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
        return (blank, torch.zeros((1, 64, 64), dtype=torch.float32), layers)


class ZeroImageStudioModelLoader:
    """One loader node that matches the graph mockup: MODEL, CLIP, VAE.

    The studio UI reads the widget values (file names) without executing the
    graph. Executing the graph really loads the weights, same as UNETLoader /
    CLIPLoader / VAELoader / CheckpointLoaderSimple.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "loader": (["diffusion", "checkpoint"], {"default": "diffusion"}),
                "ckpt_name": (_list("checkpoints"),),
                "unet_name": (_list("diffusion_models"),),
                "clip_name": (_list("text_encoders"),),
                "clip_type": (_clip_types(), {"default": "krea2"}),
                "vae_name": (_list("vae"),),
                "weight_dtype": (_dtypes(), {"default": "default"}),
            }
        }

    RETURN_TYPES = ("MODEL", "CLIP", "VAE")
    RETURN_NAMES = ("MODEL", "CLIP", "VAE")
    FUNCTION = "load"
    CATEGORY = "ZeroImageStudio"
    DESCRIPTION = "Загрузчик файлов для ноды ZeroImageStudio. В ZeroImageStudio имена файлов читаются из виджетов; при запуске графа веса загружаются по-настоящему."

    def load(self, loader, ckpt_name, unet_name, clip_name, clip_type, vae_name, weight_dtype):
        import nodes

        if loader == "checkpoint":
            if ckpt_name.startswith("("):
                raise RuntimeError("В models/checkpoints нет файла.")
            out = nodes.NODE_CLASS_MAPPINGS["CheckpointLoaderSimple"]().load_checkpoint(ckpt_name)
            return out[:3]
        if unet_name.startswith("(") or clip_name.startswith("(") or vae_name.startswith("("):
            raise RuntimeError("Не хватает файлов diffusion / text encoder / VAE.")
        model = nodes.NODE_CLASS_MAPPINGS["UNETLoader"]().load_unet(unet_name, weight_dtype)[0]
        clip = nodes.NODE_CLASS_MAPPINGS["CLIPLoader"]().load_clip(clip_name, clip_type, "default")[0]
        vae = nodes.NODE_CLASS_MAPPINGS["VAELoader"]().load_vae(vae_name)[0]
        return (model, clip, vae)


NODE_CLASS_MAPPINGS = {
    "ZeroImageStudio": ZeroImageStudio,
    "ZeroImageStudioModelLoader": ZeroImageStudioModelLoader,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "ZeroImageStudio": "ZeroImageStudio — редактор изображений",
    "ZeroImageStudioModelLoader": "ZeroImageStudio — загрузчик моделей",
}
