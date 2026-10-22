"""ZeroImageStudio — full-page region editor.

Drop this folder into ComfyUI/custom_nodes and restart.
The directory name is not fixed: ComfyUI loads the package from its path,
and the editor page resolves itself with import.meta.url.
"""

from __future__ import annotations

import traceback

WEB_DIRECTORY = "./web"

_KREA_ERROR = None
try:
    from . import zeroimagestudio_krea2edit as _krea

    _KREA_MAP = dict(_krea.NODE_CLASS_MAPPINGS)
    _KREA_NAMES = dict(_krea.NODE_DISPLAY_NAME_MAPPINGS)
except Exception as exc:  # comfy internals moved, or torch missing
    _KREA_MAP = {}
    _KREA_NAMES = {}
    _KREA_ERROR = f"{type(exc).__name__}: {exc}"
    print("[comfyui-zeroimagestudio] Krea 2 Edit nodes failed to import:", _KREA_ERROR, flush=True)
    traceback.print_exc()

from . import zeroimagestudio_nodes as _nodes
from . import zeroimagestudio_routes as _routes

NODE_CLASS_MAPPINGS = {**_nodes.NODE_CLASS_MAPPINGS, **_KREA_MAP}
NODE_DISPLAY_NAME_MAPPINGS = {**_nodes.NODE_DISPLAY_NAME_MAPPINGS, **_KREA_NAMES}

try:
    _routes.register(_KREA_ERROR)
except Exception:
    print("[comfyui-zeroimagestudio] failed to register /zeroimagestudio routes", flush=True)
    traceback.print_exc()

__all__ = ["NODE_CLASS_MAPPINGS", "NODE_DISPLAY_NAME_MAPPINGS", "WEB_DIRECTORY"]
