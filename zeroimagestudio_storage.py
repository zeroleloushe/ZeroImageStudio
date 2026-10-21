"""Filesystem layout for ZeroImageStudio projects, gallery, presets and settings.

Lives under ComfyUI's user directory (``user/zeroimagestudio``) plus commits/gallery
PNGs under the output directory so the graph node can load them.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import time
import uuid
import zipfile
from typing import Any

from PIL import Image, PngImagePlugin


def _folder_paths():
    import folder_paths

    return folder_paths


def user_root() -> str:
    fp = _folder_paths()
    root = os.path.join(fp.get_user_directory(), "zeroimagestudio")
    os.makedirs(root, exist_ok=True)
    return root


def output_root() -> str:
    fp = _folder_paths()
    root = os.path.join(fp.get_output_directory(), "zeroimagestudio")
    os.makedirs(root, exist_ok=True)
    return root


def _read_json(path: str, default: Any) -> Any:
    if not os.path.isfile(path):
        return default
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def _write_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def settings_path() -> str:
    return os.path.join(user_root(), "settings.json")


DEFAULT_SETTINGS = {
    "civitai_token": "",
    "llm_base": "http://127.0.0.1:11434/v1",
    "llm_key": "",
    "llm_model": "",
    "llm_systems": {
        "improve": (
            "Ты редактор промтов для диффузионных моделей. Улучши промт пользователя: "
            "сделай его точнее и конкретнее, сохрани язык и замысел. Верни только промт, без пояснений."
        ),
        "extend": (
            "Ты редактор промтов. Допиши промт пользователя деталями (свет, текстура, камера), "
            "не меняя уже сказанное. Верни только добавку, которую можно приклеить через запятую."
        ),
        "describe": (
            "Опиши изображение как промт для генерации: субъект, внешность, одежда, свет, фон, стиль. "
            "Язык ответа — русский, если на изображении нет причины писать иначе. Только промт."
        ),
    },
    "llm_presets": [],
}


def load_settings() -> dict:
    data = _read_json(settings_path(), {})
    merged = json.loads(json.dumps(DEFAULT_SETTINGS))
    if isinstance(data, dict):
        merged.update({k: v for k, v in data.items() if k != "llm_systems"})
        if isinstance(data.get("llm_systems"), dict):
            merged["llm_systems"].update(data["llm_systems"])
        if isinstance(data.get("llm_presets"), list):
            merged["llm_presets"] = data["llm_presets"]
    return merged


def save_settings(data: dict) -> dict:
    current = load_settings()
    for key in ("civitai_token", "llm_base", "llm_key", "llm_model"):
        if key in data and data[key] is not None:
            current[key] = str(data[key])
    if isinstance(data.get("llm_systems"), dict):
        for mode, text in data["llm_systems"].items():
            if mode in current["llm_systems"] and isinstance(text, str):
                current["llm_systems"][mode] = text
    if isinstance(data.get("llm_presets"), list):
        current["llm_presets"] = data["llm_presets"][:40]
    _write_json(settings_path(), current)
    return current


def _collection(name: str) -> str:
    path = os.path.join(user_root(), name + ".json")
    return path


def list_named(name: str) -> list:
    data = _read_json(_collection(name), [])
    return data if isinstance(data, list) else []


def save_named(name: str, item: dict) -> dict:
    items = list_named(name)
    item = dict(item)
    item["id"] = item.get("id") or uuid.uuid4().hex[:12]
    item["updated"] = int(time.time())
    items = [x for x in items if x.get("id") != item["id"]]
    items.insert(0, item)
    _write_json(_collection(name), items[:200])
    return item


def delete_named(name: str, item_id: str) -> None:
    items = [x for x in list_named(name) if x.get("id") != item_id]
    _write_json(_collection(name), items)


def safe_join(root: str, rel: str) -> str:
    rel = (rel or "").replace("\\", "/").lstrip("/")
    if ".." in rel.split("/"):
        raise ValueError("Некорректный путь.")
    root_real = os.path.realpath(root)
    path = os.path.realpath(os.path.join(root_real, rel))
    if path != root_real and not path.startswith(root_real + os.sep):
        raise ValueError("Некорректный путь.")
    return path


def write_png(path: str, data: bytes, meta: dict | None = None) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    image = Image.open(io.BytesIO(data))
    info = PngImagePlugin.PngInfo()
    if meta is not None:
        payload = json.dumps(meta, ensure_ascii=False)
        info.add_text("zeroimagestudio", payload)
        prompt = meta.get("prompt") or ""
        if prompt:
            info.add_text("parameters", prompt)
    image.save(path, format="PNG", pnginfo=info)


def read_png_meta(path: str) -> dict:
    try:
        image = Image.open(path)
        raw = (image.info or {}).get("zeroimagestudio")
        if not raw:
            return {}
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def project_dir(project_id: str) -> str:
    path = safe_join(os.path.join(user_root(), "projects"), project_id)
    os.makedirs(path, exist_ok=True)
    return path


def save_project_files(project_id: str, meta: dict, files: dict[str, bytes]) -> str:
    folder = project_dir(project_id)
    for name, blob in files.items():
        dest = safe_join(folder, name)
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        # store pngs with the project meta on the flattened preview only
        if name.lower().endswith(".png"):
            write_png(dest, blob, meta if name == "preview.png" else None)
        else:
            with open(dest, "wb") as f:
                f.write(blob)
    _write_json(os.path.join(folder, "project.json"), meta)
    return project_id


def load_project_meta(project_id: str) -> dict:
    folder = project_dir(project_id)
    return _read_json(os.path.join(folder, "project.json"), {})


def project_file(project_id: str, name: str) -> str:
    return safe_join(project_dir(project_id), name)


def export_project_zip(project_id: str) -> bytes:
    folder = project_dir(project_id)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirs, filenames in os.walk(folder):
            for filename in filenames:
                full = os.path.join(dirpath, filename)
                rel = os.path.relpath(full, folder).replace("\\", "/")
                zf.write(full, rel)
    return buf.getvalue()


def import_project_zip(blob: bytes) -> str:
    project_id = new_id()
    folder = project_dir(project_id)
    with zipfile.ZipFile(io.BytesIO(blob)) as zf:
        for info in zf.infolist():
            if info.is_dir():
                continue
            name = info.filename.replace("\\", "/")
            if name.startswith("/") or ".." in name.split("/"):
                continue
            dest = safe_join(folder, name)
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with zf.open(info) as src, open(dest, "wb") as dst:
                dst.write(src.read())
    if not os.path.isfile(os.path.join(folder, "project.json")):
        raise ValueError("В архиве нет project.json.")
    return project_id


def commit_image(image_bytes: bytes, mask_bytes: bytes | None, meta: dict) -> dict:
    folder = os.path.join(output_root(), "commits")
    os.makedirs(folder, exist_ok=True)
    ident = new_id()
    image_rel = f"zeroimagestudio/commits/{ident}.png"
    write_png(os.path.join(folder, ident + ".png"), image_bytes, meta)
    mask_rel = ""
    if mask_bytes:
        mask_rel = f"zeroimagestudio/commits/{ident}_mask.png"
        write_png(os.path.join(folder, ident + "_mask.png"), mask_bytes, None)
    return {"image": image_rel, "mask": mask_rel, "id": ident}


def gallery_dir() -> str:
    path = os.path.join(output_root(), "gallery")
    os.makedirs(path, exist_ok=True)
    return path


def save_gallery_image(image_bytes: bytes, meta: dict) -> dict:
    ident = new_id()
    path = os.path.join(gallery_dir(), ident + ".png")
    meta = dict(meta or {})
    meta.setdefault("id", ident)
    meta.setdefault("created", int(time.time()))
    write_png(path, image_bytes, meta)
    return {"id": ident, "file": f"zeroimagestudio/gallery/{ident}.png", "meta": meta}


def list_gallery() -> list[dict]:
    items = []
    folder = gallery_dir()
    for name in os.listdir(folder):
        if not name.lower().endswith(".png"):
            continue
        path = os.path.join(folder, name)
        meta = read_png_meta(path)
        ident = name[:-4]
        meta.setdefault("id", ident)
        try:
            meta.setdefault("created", int(os.path.getmtime(path)))
        except OSError:
            meta.setdefault("created", 0)
        items.append({"id": ident, "file": f"zeroimagestudio/gallery/{name}", "meta": meta})
    items.sort(key=lambda x: x["meta"].get("created") or 0, reverse=True)
    return items


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_cache_path() -> str:
    return os.path.join(user_root(), "hash_cache.json")


def cached_sha256(path: str) -> str:
    st = os.stat(path)
    key = f"{path}|{st.st_mtime_ns}|{st.st_size}"
    cache = _read_json(hash_cache_path(), {})
    if cache.get(key):
        return cache[key]
    digest = sha256_file(path)
    # keep the cache bounded
    if len(cache) > 400:
        cache = {}
    cache[key] = digest
    _write_json(hash_cache_path(), cache)
    return digest


def civitai_cache_path() -> str:
    return os.path.join(user_root(), "civitai_cache.json")


def civitai_get(file_hash: str) -> dict | None:
    cache = _read_json(civitai_cache_path(), {})
    item = cache.get(file_hash)
    return item if isinstance(item, dict) else None


def civitai_put(file_hash: str, payload: dict) -> None:
    cache = _read_json(civitai_cache_path(), {})
    cache[file_hash] = payload
    if len(cache) > 400:
        # drop arbitrary extras
        for k in list(cache)[:50]:
            cache.pop(k, None)
    _write_json(civitai_cache_path(), cache)
