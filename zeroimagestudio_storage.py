"""Filesystem layout for ZeroImageStudio projects, gallery, presets and settings.

Lives under ComfyUI's user directory (``user/zeroimagestudio``) plus commits/gallery
PNGs under the output directory so the graph node can load them.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
import zipfile
from typing import Any

_JSON_LOCK = threading.RLock()
_PROJECT_ID_RE = re.compile(r"^[0-9a-fA-F]{8,64}$")
ZIP_MAX_FILES = 200
ZIP_MAX_FILE = 64 * 1024 * 1024
ZIP_MAX_TOTAL = 256 * 1024 * 1024
GALLERY_PAGE = 60
COMMIT_KEEP = 8

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
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, UnicodeDecodeError):
        stamp = int(time.time() * 1000)
        dest = f"{path}.broken-{stamp}"
        n = 0
        while os.path.exists(dest):
            n += 1
            dest = f"{path}.broken-{stamp}-{n}"
        try:
            os.replace(path, dest)
        except OSError:
            pass
        return default


def _write_json(path: str, data: Any) -> None:
    folder = os.path.dirname(path) or "."
    os.makedirs(folder, exist_ok=True)
    fd, tmp = tempfile.mkstemp(prefix=".tmp-", suffix=".json", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
            f.flush()
            os.fsync(f.fileno())
        with _JSON_LOCK:
            os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


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


def mask_secret(value: str) -> str:
    text = str(value or "")
    if not text:
        return ""
    if len(text) <= 4:
        return "•" * len(text)
    return ("•" * (len(text) - 4)) + text[-4:]


def _secret_unchanged(incoming, current: str) -> bool:
    if incoming is None:
        return True
    text = str(incoming)
    if text.strip() == "":
        return True
    if text == mask_secret(current or ""):
        return True
    if text and set(text) <= {"•", "*"}:
        return True
    return False


def public_settings(data: dict | None = None) -> dict:
    current = data if isinstance(data, dict) else load_settings()
    out = json.loads(json.dumps(current))
    token = str(out.get("civitai_token") or "")
    key = str(out.get("llm_key") or "")
    out["has_civitai_token"] = bool(token)
    out["has_llm_key"] = bool(key)
    out["civitai_token"] = mask_secret(token)
    out["llm_key"] = mask_secret(key)
    return out


def save_settings(data: dict) -> dict:
    with _JSON_LOCK:
        current = load_settings()
        for key in ("llm_base", "llm_model"):
            if key in data and data[key] is not None:
                current[key] = str(data[key])
        if "civitai_token" in data and not _secret_unchanged(data.get("civitai_token"), current.get("civitai_token") or ""):
            current["civitai_token"] = str(data["civitai_token"])
        if "llm_key" in data and not _secret_unchanged(data.get("llm_key"), current.get("llm_key") or ""):
            current["llm_key"] = str(data["llm_key"])
        if isinstance(data.get("llm_systems"), dict):
            for mode, text in data["llm_systems"].items():
                if mode in current["llm_systems"] and isinstance(text, str):
                    current["llm_systems"][mode] = text
        if isinstance(data.get("llm_presets"), list):
            current["llm_presets"] = data["llm_presets"][:40]
        if isinstance(data.get("layout"), dict):
            current["layout"] = _clean_layout(data["layout"])
        _write_json(settings_path(), current)
        return public_settings(current)


def _clean_layout(raw: dict) -> dict:
    columns = ("left", "center", "right")
    cleaned = {col: [] for col in columns}
    seen = set()
    for col in columns:
        values = raw.get(col)
        if not isinstance(values, list):
            continue
        for item in values:
            if not isinstance(item, str) or item in seen or len(item) > 40:
                continue
            if item == "canvas" and col != "center":
                continue
            seen.add(item)
            cleaned[col].append(item)
    collapsed_in = raw.get("collapsed") if isinstance(raw.get("collapsed"), dict) else {}
    collapsed = {}
    for key, value in collapsed_in.items():
        if isinstance(key, str) and key != "canvas" and value and len(key) <= 40:
            collapsed[key] = True
    hidden_in = raw.get("hidden") if isinstance(raw.get("hidden"), dict) else {}
    hidden = {}
    for key, value in hidden_in.items():
        if isinstance(key, str) and key != "canvas" and value and len(key) <= 40:
            hidden[key] = True
    cleaned["collapsed"] = collapsed
    cleaned["hidden"] = hidden
    return cleaned


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
    with Image.open(io.BytesIO(data)) as image:
        image.load()
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
        with Image.open(path) as image:
            raw = (image.info or {}).get("zeroimagestudio")
            if not raw:
                return {}
            data = json.loads(raw)
            return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def new_id() -> str:
    return uuid.uuid4().hex[:16]


def valid_project_id(project_id: str) -> bool:
    return _PROJECT_ID_RE.fullmatch(str(project_id or "")) is not None


def project_dir(project_id: str, create: bool = False) -> str:
    if not valid_project_id(project_id):
        raise ValueError("Некорректный идентификатор проекта.")
    path = safe_join(os.path.join(user_root(), "projects"), project_id)
    if create:
        os.makedirs(path, exist_ok=True)
    return path


def save_project_files(project_id: str, meta: dict, files: dict[str, bytes]) -> str:
    folder = project_dir(project_id, create=True)
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
    folder = project_dir(project_id, create=False)
    path = os.path.join(folder, "project.json")
    if not os.path.isfile(path):
        return {}
    return _read_json(path, {})


def project_file(project_id: str, name: str) -> str:
    return safe_join(project_dir(project_id, create=False), name)


def export_project_zip(project_id: str) -> bytes:
    folder = project_dir(project_id, create=False)
    if not os.path.isdir(folder):
        raise ValueError("Проект не найден.")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for dirpath, _dirs, filenames in os.walk(folder):
            for filename in filenames:
                full = os.path.join(dirpath, filename)
                rel = os.path.relpath(full, folder).replace("\\", "/")
                zf.write(full, rel)
    return buf.getvalue()


class _LimitedReader:
    def __init__(self, raw, limit: int):
        self.raw = raw
        self.limit = limit
        self.read_bytes = 0

    def read(self, n=-1):
        if self.read_bytes > self.limit:
            raise ValueError("Файл в архиве слишком большой.")
        if n is None or n < 0:
            n = 1024 * 1024
        room = self.limit - self.read_bytes + 1
        chunk = self.raw.read(min(n, room))
        self.read_bytes += len(chunk)
        if self.read_bytes > self.limit:
            raise ValueError("Файл в архиве слишком большой.")
        return chunk


def import_project_zip(blob: bytes) -> str:
    project_id = new_id()
    folder = project_dir(project_id, create=True)
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as zf:
            infos = [info for info in zf.infolist() if not info.is_dir()]
            if len(infos) > ZIP_MAX_FILES:
                raise ValueError(f"В архиве больше {ZIP_MAX_FILES} файлов.")
            total = 0
            names = []
            for info in infos:
                name = info.filename.replace("\\", "/")
                if not name or name.startswith("/") or ".." in name.split("/"):
                    raise ValueError("Некорректное имя в архиве.")
                size = int(info.file_size or 0)
                if size > ZIP_MAX_FILE:
                    raise ValueError("Файл в архиве слишком большой.")
                total += size
                if total > ZIP_MAX_TOTAL:
                    raise ValueError("Архив слишком большой.")
                names.append(name)
            written = 0
            for info, name in zip(infos, names):
                dest = safe_join(folder, name)
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                with zf.open(info) as src, open(dest, "wb") as dst:
                    reader = _LimitedReader(src, ZIP_MAX_FILE)
                    shutil.copyfileobj(reader, dst, length=1024 * 1024)
                    written += reader.read_bytes
                if written > ZIP_MAX_TOTAL:
                    raise ValueError("Архив слишком большой.")
        if not os.path.isfile(os.path.join(folder, "project.json")):
            raise ValueError("В архиве нет project.json.")
    except Exception:
        shutil.rmtree(folder, ignore_errors=True)
        raise
    return project_id


def _commit_index_path() -> str:
    return os.path.join(output_root(), "commits", "index.json")


def _backfill_commits(folder: str, index: list) -> list:
    known = {item.get("id") for item in index if isinstance(item, dict)}
    try:
        names = os.listdir(folder)
    except OSError:
        return index
    for name in names:
        if not name.lower().endswith(".png") or name.lower().endswith("_mask.png"):
            continue
        ident = name[:-4]
        if ident in known:
            continue
        path = os.path.join(folder, name)
        meta = read_png_meta(path)
        try:
            created = int(os.path.getmtime(path))
        except OSError:
            created = 0
        index.append({
            "id": ident,
            "project_id": str(meta.get("projectId") or meta.get("project_id") or ""),
            "created": created,
        })
        known.add(ident)
    return index


def _prune_commits(folder: str, index: list) -> list:
    latest: dict[str, dict] = {}
    for item in index:
        if not isinstance(item, dict) or not item.get("id"):
            continue
        ident = str(item["id"])
        prev = latest.get(ident)
        if prev is None or (item.get("created") or 0) >= (prev.get("created") or 0):
            latest[ident] = item
    groups: dict[str, list] = {}
    for item in latest.values():
        groups.setdefault(str(item.get("project_id") or ""), []).append(item)
    kept: list = []
    for items in groups.values():
        items.sort(key=lambda row: row.get("created") or 0)
        stale = items[:-COMMIT_KEEP] if len(items) > COMMIT_KEEP else []
        kept.extend(items[-COMMIT_KEEP:])
        for item in stale:
            ident = str(item.get("id"))
            for suffix in (".png", "_mask.png"):
                try:
                    os.remove(os.path.join(folder, ident + suffix))
                except OSError:
                    pass
    return kept


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
    index = _read_json(_commit_index_path(), [])
    if not isinstance(index, list):
        index = []
    index = _backfill_commits(folder, index)
    if not any(isinstance(item, dict) and item.get("id") == ident for item in index):
        index.append({
            "id": ident,
            "project_id": str((meta or {}).get("projectId") or (meta or {}).get("project_id") or ""),
            "created": int(time.time()),
        })
    _write_json(_commit_index_path(), _prune_commits(folder, index))
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


def _gallery_index_path() -> str:
    return os.path.join(gallery_dir(), "index.json")


def list_gallery(offset: int = 0, limit: int | None = GALLERY_PAGE) -> dict:
    folder = gallery_dir()
    index = _read_json(_gallery_index_path(), {})
    if not isinstance(index, dict):
        index = {}
    fresh: dict[str, dict] = {}
    items = []
    dirty = False
    try:
        names = os.listdir(folder)
    except OSError:
        names = []
    for name in names:
        if not name.lower().endswith(".png"):
            continue
        path = os.path.join(folder, name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        mtime = int(getattr(st, "st_mtime_ns", int(st.st_mtime * 1e9)))
        size = int(st.st_size)
        cached = index.get(name) if isinstance(index.get(name), dict) else None
        if cached and cached.get("mtime_ns") == mtime and cached.get("size") == size and isinstance(cached.get("meta"), dict):
            meta = dict(cached["meta"])
        else:
            meta = read_png_meta(path)
            dirty = True
        ident = name[:-4]
        meta.setdefault("id", ident)
        try:
            meta.setdefault("created", int(st.st_mtime))
        except OSError:
            meta.setdefault("created", 0)
        fresh[name] = {"mtime_ns": mtime, "size": size, "meta": meta}
        items.append({"id": ident, "file": f"zeroimagestudio/gallery/{name}", "meta": meta})
    if dirty or set(fresh) != {key for key, val in index.items() if isinstance(val, dict)}:
        _write_json(_gallery_index_path(), fresh)
    items.sort(key=lambda row: row["meta"].get("created") or 0, reverse=True)
    total = len(items)
    try:
        start = max(0, int(0 if offset is None else offset))
    except (TypeError, ValueError):
        start = 0
    if limit is None:
        page = items[start:]
        limit_out = len(page)
    else:
        try:
            size = int(limit)
        except (TypeError, ValueError):
            size = GALLERY_PAGE
        size = max(1, min(200, size))
        page = items[start:start + size]
        limit_out = size
    return {"items": page, "total": total, "offset": start, "limit": limit_out}


def sha256_file(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def hash_cache_path() -> str:
    return os.path.join(user_root(), "hash_cache.json")


def cached_sha256(path: str) -> str:
    with _JSON_LOCK:
        st = os.stat(path)
        key = f"{path}|{st.st_mtime_ns}|{st.st_size}"
        cache = _read_json(hash_cache_path(), {})
        if not isinstance(cache, dict):
            cache = {}
        if cache.get(key):
            return cache[key]
        digest = sha256_file(path)
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


_ASSET_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}


def assets_dir() -> str:
    path = os.path.join(user_root(), "assets")
    os.makedirs(path, exist_ok=True)
    return path


def _assets_index() -> str:
    return os.path.join(assets_dir(), "index.json")


def list_assets() -> list[dict]:
    data = _read_json(_assets_index(), [])
    return data if isinstance(data, list) else []


def _asset_ext(name: str, mime: str) -> str:
    ext = os.path.splitext(name or "")[1].lower()
    if ext in _ASSET_EXT:
        return ".jpg" if ext == ".jpeg" else ext
    if "png" in (mime or ""):
        return ".png"
    if "webp" in (mime or ""):
        return ".webp"
    if "gif" in (mime or ""):
        return ".gif"
    return ".jpg"


def _valid_asset_id(value: str) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(c in "0123456789abcdef" for c in value)


def save_asset(data: bytes, name: str, mime: str, role: str, project_id: str | None, import_settings: dict | None) -> dict:
    digest = hashlib.sha256(data).hexdigest()
    ext = _asset_ext(name, mime)
    folder = assets_dir()
    original = os.path.join(folder, digest + ext)
    if not os.path.isfile(original):
        with open(original, "wb") as handle:
            handle.write(data)
    width = height = 0
    try:
        with Image.open(io.BytesIO(data)) as image:
            width, height = image.size
            thumb = image.convert("RGB")
            thumb.thumbnail((256, 256))
            thumb.save(os.path.join(folder, digest + ".thumb.jpg"), format="JPEG", quality=80)
    except Exception:
        width = height = 0
    items = list_assets()
    found = next((item for item in items if item.get("sha256") == digest), None)
    if found is None:
        found = {
            "id": digest,
            "sha256": digest,
            "name": name or digest[:12],
            "mime": mime or "application/octet-stream",
            "width": width,
            "height": height,
            "bytes": len(data),
            "created": int(time.time()),
            "roles": [],
            "project_ids": [],
            "import": None,
            "ext": ext,
        }
        items.insert(0, found)
    else:
        if width and height:
            found["width"] = width
            found["height"] = height
        found["bytes"] = len(data)
    if name:
        found["name"] = name
    if role in ("canvas", "reference") and role not in found["roles"]:
        found["roles"].append(role)
    if project_id and project_id not in found.get("project_ids", []):
        found.setdefault("project_ids", []).append(str(project_id))
    if isinstance(import_settings, dict):
        found["import"] = import_settings
    _write_json(_assets_index(), items)
    return found


def asset_path(asset_id: str, thumb: bool = False) -> str | None:
    if not _valid_asset_id(asset_id):
        return None
    if thumb:
        path = os.path.join(assets_dir(), asset_id + ".thumb.jpg")
        return path if os.path.isfile(path) else None
    item = next((row for row in list_assets() if row.get("id") == asset_id), None)
    if not item:
        return None
    path = os.path.join(assets_dir(), asset_id + str(item.get("ext") or ""))
    return path if os.path.isfile(path) else None


def delete_asset(asset_id: str) -> None:
    if not _valid_asset_id(asset_id):
        return
    items = [item for item in list_assets() if item.get("id") != asset_id]
    _write_json(_assets_index(), items)
    folder = assets_dir()
    for name in os.listdir(folder):
        if name == "index.json":
            continue
        if name.startswith(asset_id):
            try:
                os.remove(os.path.join(folder, name))
            except OSError:
                pass


def civitai_put(file_hash: str, payload: dict) -> None:
    cache = _read_json(civitai_cache_path(), {})
    cache[file_hash] = payload
    if len(cache) > 400:
        # drop arbitrary extras
        for k in list(cache)[:50]:
            cache.pop(k, None)
    _write_json(civitai_cache_path(), cache)
