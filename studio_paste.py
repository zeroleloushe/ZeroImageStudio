"""Seamless paste-back of a generated crop onto the original pixels.

Feathered alpha, optional Reinhard color match on the border, and a
coarse-to-fine Jacobi Poisson blend (Pérez 2003) in NumPy. No third-party
custom nodes. Torch is not required.
"""

from __future__ import annotations

import numpy as np
from PIL import Image


def _to_float(image: Image.Image) -> np.ndarray:
    arr = np.asarray(image.convert("RGB"), dtype=np.float32) / 255.0
    return arr


def _mask_float(image: Image.Image, size: tuple[int, int]) -> np.ndarray:
    m = image.convert("L").resize(size, Image.Resampling.BILINEAR)
    return np.asarray(m, dtype=np.float32) / 255.0


def _resize_rgb(image: Image.Image, size: tuple[int, int]) -> np.ndarray:
    if image.size != size:
        image = image.convert("RGB").resize(size, Image.Resampling.LANCZOS)
    else:
        image = image.convert("RGB")
    return np.asarray(image, dtype=np.float32) / 255.0


def box_blur(mask: np.ndarray, radius: int) -> np.ndarray:
    r = int(radius)
    if r <= 0:
        return mask.astype(np.float32, copy=False)
    m = mask.astype(np.float32, copy=True)

    def blur1(a: np.ndarray, rad: int) -> np.ndarray:
        k = rad * 2 + 1
        pad = np.pad(a, ((rad, rad), (0, 0)), mode="edge")
        c = np.cumsum(pad, axis=0, dtype=np.float64)
        c = np.concatenate([np.zeros((1, a.shape[1]), dtype=np.float64), c], axis=0)
        out = (c[k:] - c[:-k]) / k
        return out.astype(np.float32)

    # Three box passes approximate a gaussian.
    for _ in range(3):
        m = blur1(m, r)
        m = blur1(m.T, r).T
    return np.clip(m, 0.0, 1.0)


def color_match(src: np.ndarray, dst: np.ndarray, mask: np.ndarray) -> np.ndarray:
    """Match mean/variance of src to dst on the low-mask border (Reinhard on RGB)."""
    src = src.copy()
    border = mask < 0.25
    if int(border.sum()) < 40:
        border = np.zeros(mask.shape, dtype=bool)
        border[0, :] = border[-1, :] = border[:, 0] = border[:, -1] = True
        # a 4px ring
        ring = max(2, min(8, mask.shape[0] // 20, mask.shape[1] // 20))
        border[:ring, :] = True
        border[-ring:, :] = True
        border[:, :ring] = True
        border[:, -ring:] = True
    if int(border.sum()) < 8:
        return np.clip(src, 0.0, 1.0)
    for c in range(3):
        s = src[..., c][border]
        d = dst[..., c][border]
        ss = float(s.std())
        sd = float(d.std())
        src[..., c] = (src[..., c] - float(s.mean())) * (sd / (ss + 1e-5)) + float(d.mean())
    return np.clip(src, 0.0, 1.0)


def _down2(img: np.ndarray) -> np.ndarray:
    h, w = img.shape[:2]
    h2, w2 = h // 2 * 2, w // 2 * 2
    if h2 < 2 or w2 < 2:
        return img
    a = img[:h2, :w2]
    if a.ndim == 2:
        return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) * 0.25
    return (a[0::2, 0::2] + a[1::2, 0::2] + a[0::2, 1::2] + a[1::2, 1::2]) * 0.25


def _up2(img: np.ndarray, shape: tuple[int, int]) -> np.ndarray:
    h, w = shape
    out = np.repeat(np.repeat(img, 2, axis=0), 2, axis=1)
    pad_h = h - out.shape[0]
    pad_w = w - out.shape[1]
    if pad_h > 0 or pad_w > 0:
        if out.ndim == 2:
            out = np.pad(out, ((0, max(0, pad_h)), (0, max(0, pad_w))), mode="edge")
        else:
            out = np.pad(out, ((0, max(0, pad_h)), (0, max(0, pad_w)), (0, 0)), mode="edge")
    return out[:h, :w]


def _neighbors(f: np.ndarray):
    up = np.empty_like(f)
    down = np.empty_like(f)
    left = np.empty_like(f)
    right = np.empty_like(f)
    up[0] = f[0]
    up[1:] = f[:-1]
    down[-1] = f[-1]
    down[:-1] = f[1:]
    left[:, 0] = f[:, 0]
    left[:, 1:] = f[:, :-1]
    right[:, -1] = f[:, -1]
    right[:, :-1] = f[:, 1:]
    return up, down, left, right


def _jacobi(src_c, dst_c, hard, init, iters: int) -> np.ndarray:
    up, down, left, right = _neighbors(src_c)
    lap = up + down + left + right - 4.0 * src_c
    f = init.astype(np.float32, copy=True)
    for _ in range(iters):
        up, down, left, right = _neighbors(f)
        updated = (up + down + left + right - lap) * 0.25
        f = np.where(hard, updated, dst_c)
    return f


def poisson_channel(src_c, dst_c, mask: np.ndarray, depth: int = 0) -> np.ndarray:
    h, w = mask.shape
    hard = mask > 0.5
    if int(hard.sum()) < 8:
        return dst_c.copy()
    if max(h, w) > 160 and depth < 4 and min(h, w) >= 8:
        small = poisson_channel(_down2(src_c), _down2(dst_c), _down2(mask), depth + 1)
        init = _up2(small, (h, w))
        iters = 30
    else:
        init = dst_c
        iters = 80
    return _jacobi(src_c, dst_c, hard, init, iters)


def poisson_blend(src: np.ndarray, dst: np.ndarray, mask: np.ndarray) -> np.ndarray:
    out = np.empty_like(src)
    for c in range(3):
        out[..., c] = poisson_channel(src[..., c], dst[..., c], mask)
    return np.clip(out, 0.0, 1.0)


def paste(
    result: Image.Image,
    original: Image.Image,
    mask: Image.Image,
    mode: str = "feather",
    feather: int = 48,
    color: bool = True,
) -> Image.Image:
    """Return an RGBA image the size of `original`.

    Feather / hard: RGB is the (optionally color-matched) result, alpha is the mask,
    so a normal layer composite reveals the original outside the mask.
    Poisson: RGB is the solved composite (already matches `original` outside the
    mask) and alpha is opaque, so the layer replaces the crop.
    """
    size = original.convert("RGB").size  # (w, h)
    src = _resize_rgb(result, size)
    dst = _resize_rgb(original, size)
    m = _mask_float(mask, size)
    if color:
        src = color_match(src, dst, m)
    mode = (mode or "feather").lower()
    if mode == "poisson":
        solved = poisson_blend(src, dst, m)
        # Keep a one-pixel feather at the crop border so a partial crop doesn't ring.
        alpha = np.ones(m.shape, dtype=np.float32)
        rgba = np.dstack([solved, alpha])
    elif mode == "hard":
        alpha = (m > 0.5).astype(np.float32)
        rgba = np.dstack([src, alpha])
    else:
        alpha = box_blur(m, int(feather or 0))
        rgba = np.dstack([src, alpha])
    out = (np.clip(rgba, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    return Image.fromarray(out, "RGBA")
