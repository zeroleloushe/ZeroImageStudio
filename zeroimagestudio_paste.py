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
        ratio = sd / (ss + 1e-5)
        if ratio < 0.5:
            ratio = 0.5
        elif ratio > 2.0:
            ratio = 2.0
        src[..., c] = (src[..., c] - float(s.mean())) * ratio + float(d.mean())
    return np.clip(src, 0.0, 1.0)


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


def erode_binary(hard: np.ndarray, radius: int) -> np.ndarray:
    """Square erosion. Border pixels within `radius` of the outside are removed."""
    r = int(radius)
    if r <= 0:
        return hard
    h, w = hard.shape
    src = hard.astype(np.uint8)
    pref = np.zeros((h, w + 1), dtype=np.int32)
    pref[:, 1:] = np.cumsum(src, axis=1)
    xs = np.arange(w)
    x0 = np.clip(xs - r, 0, w)
    x1 = np.clip(xs + r + 1, 0, w)
    span = 2 * r + 1
    horiz = (pref[:, x1] - pref[:, x0] == span) & ((x1 - x0) == span)
    src2 = horiz.astype(np.uint8)
    pref2 = np.zeros((h + 1, w), dtype=np.int32)
    pref2[1:, :] = np.cumsum(src2, axis=0)
    ys = np.arange(h)
    y0 = np.clip(ys - r, 0, h)
    y1 = np.clip(ys + r + 1, 0, h)
    return (pref2[y1, :] - pref2[y0, :] == span) & ((y1 - y0) == span)[:, None]


def _jacobi_ring(src_c, dst_c, ring, interior, iters: int) -> np.ndarray:
    """Poisson in the seam ring only. Interior stays src, outside stays dst."""
    fixed = np.where(interior, src_c, dst_c)
    up, down, left, right = _neighbors(src_c)
    lap = up + down + left + right - 4.0 * src_c
    f = np.where(ring, src_c, fixed).astype(np.float32, copy=True)
    for _ in range(iters):
        up, down, left, right = _neighbors(f)
        updated = (up + down + left + right - lap) * 0.25
        f = np.where(ring, updated, fixed)
    return f


def poisson_channel(src_c, dst_c, mask: np.ndarray, seam: int = 0) -> np.ndarray:
    hard = mask > 0.5
    if int(hard.sum()) < 8:
        return dst_c.copy()
    radius = max(0, int(seam))
    if radius <= 0:
        return np.where(hard, src_c, dst_c)
    interior = erode_binary(hard, radius)
    ring = hard & ~interior
    # A mask thinner than the seam has no safe interior. Keep the generated
    # colours rather than letting a full-domain solve wash them out.
    if int(ring.sum()) < 8 or int(interior.sum()) < 8:
        return np.where(hard, src_c, dst_c)
    iters = int(min(200, max(48, radius * 8)))
    solved = _jacobi_ring(src_c, dst_c, ring, interior, iters)
    # Pin the interior exactly. The ring carries the seam.
    return np.where(interior, src_c, solved)


def poisson_blend(src: np.ndarray, dst: np.ndarray, mask: np.ndarray, seam: int = 0) -> np.ndarray:
    out = np.empty_like(src)
    for c in range(3):
        out[..., c] = poisson_channel(src[..., c], dst[..., c], mask, seam)
    return np.clip(out, 0.0, 1.0)


def mask_min_side(mask: np.ndarray) -> int:
    """Smaller side of the opaque mask, not of the whole crop."""
    hard = mask > 0.5
    ys, xs = np.where(hard)
    if len(xs) == 0:
        return 1
    return max(1, min(int(ys.max() - ys.min() + 1), int(xs.max() - xs.min() + 1)))


def clamp_feather(feather: int, mask: np.ndarray) -> int:
    """Same cap as effective_seam: at most about a fifth of the mask's min side."""
    from zeroimagestudio_geom import effective_seam

    side = mask_min_side(mask)
    return effective_seam(feather, side, side, mode="manual")


def paste(
    result: Image.Image,
    original: Image.Image,
    mask: Image.Image,
    mode: str = "feather",
    feather: int = 48,
    color: bool = True,
) -> Image.Image:
    """Return an RGBA image the size of `original`.

    Feather / hard: RGB is the (optionally color-matched) result. Alpha is the
    mask, feathered for the seam, so a normal composite shows the original outside.

    Poisson: the generated interior is copied verbatim. Pérez is solved only in a
    ring of width `feather`, with the destination on the outer edge and the
    generated colour on the inner edge. Alpha is the hard mask, not a second blur.
    """
    size = original.convert("RGB").size  # (w, h)
    src = _resize_rgb(result, size)
    dst = _resize_rgb(original, size)
    m = _mask_float(mask, size)
    mode = (mode or "feather").lower()
    seam = clamp_feather(int(feather or 0), m)
    # Poisson already carries the destination colour in the ring. A second transfer blows out the ratio.
    if color and mode != "poisson":
        src = color_match(src, dst, m)
    if mode == "poisson":
        solved = poisson_blend(src, dst, m, seam)
        alpha = (m > 0.5).astype(np.float32)
        rgba = np.dstack([solved, alpha])
    elif mode == "hard":
        alpha = (m > 0.5).astype(np.float32)
        rgba = np.dstack([src, alpha])
    else:
        alpha = box_blur(m, max(1, seam // 3)) if seam > 0 else m
        rgba = np.dstack([src, alpha])
    out = (np.clip(rgba, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    return Image.fromarray(out, "RGBA")
