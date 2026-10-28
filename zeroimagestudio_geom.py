"""Edit crop geometry shared by generation and paste-back.

The browser computes the same numbers in web/zeroimagestudio_size.js.
Keep the two implementations on the same examples in the tests.
"""

from __future__ import annotations

import math


def effective_seam(requested: float, mask_w: float, mask_h: float, mode: str = "auto") -> int:
    side = max(1, min(int(mask_w or 1), int(mask_h or 1)))
    cap = max(0, int(round(side * 0.2)))
    if mode != "manual":
        px = int(round(side * 0.04))
        if px < 4:
            px = 4
        if px > 64:
            px = 64
        if px > cap:
            px = cap
        return px
    return min(max(0, int(round(requested or 0))), cap)


def clamp_rect(rect: dict, doc_w: int, doc_h: int) -> dict:
    x = max(0, int(round(rect["x"])))
    y = max(0, int(round(rect["y"])))
    x2 = min(doc_w, int(round(rect["x"] + rect["w"])))
    y2 = min(doc_h, int(round(rect["y"] + rect["h"])))
    if x2 <= x:
        x2 = min(doc_w, x + 1)
    if y2 <= y:
        y2 = min(doc_h, y + 1)
    return {"x": x, "y": y, "w": x2 - x, "h": y2 - y}


def _snap(n: float, step: int = 16, minimum: int = 64) -> int:
    s = max(1, step)
    snapped = int(round(n / s) * s)
    return max(minimum, snapped) if snapped < minimum else snapped


def edit_geometry(
    doc_w: int,
    doc_h: int,
    frame: dict,
    mask_bbox: dict | None,
    seam_doc: float,
    grow_doc: float,
    context: float,
    mp: float = 1,
    step: int = 16,
    mode: str = "auto",
) -> dict:
    sides = (mask_bbox["w"], mask_bbox["h"]) if mask_bbox else (frame["w"], frame["h"])
    seam = effective_seam(seam_doc, sides[0], sides[1], mode)
    grow = max(0, int(round(grow_doc or 0)))
    core = mask_bbox or frame
    band = seam + grow
    frac = max(0.0, float(context or 0))
    px = int(round(frame["w"] * frac))
    py = int(round(frame["h"] * frac))
    x2 = min(doc_w, int(frame["x"] + frame["w"] + px))
    y2 = min(doc_h, int(frame["y"] + frame["h"] + py))
    framed = clamp_rect(
        {"x": frame["x"] - px, "y": frame["y"] - py, "w": x2 - (frame["x"] - px), "h": y2 - (frame["y"] - py)},
        doc_w,
        doc_h,
    )
    crop = clamp_rect(
        {"x": framed["x"] - band, "y": framed["y"] - band, "w": framed["w"] + band * 2, "h": framed["h"] + band * 2},
        doc_w,
        doc_h,
    )
    pixels = max(0.25, float(mp or 1)) * 1e6
    ratio = max(1, crop["w"]) / max(1, crop["h"])
    height = math.sqrt(pixels / ratio)
    budget_w = _snap(height * ratio, step)
    budget_h = _snap(height, step)
    gen_h = math.sqrt(max(step * step, budget_w * budget_h) / ratio)
    gen = {"w": _snap(gen_h * ratio, step), "h": _snap(gen_h, step)}
    scale_fit = min(gen["w"] / crop["w"], gen["h"] / crop["h"])
    pw = max(1, int(round(crop["w"] * scale_fit)))
    ph = max(1, int(round(crop["h"] * scale_fit)))
    placed = {"x": (gen["w"] - pw) // 2, "y": (gen["h"] - ph) // 2, "w": pw, "h": ph}
    scale = placed["w"] / max(1, crop["w"])
    blend = clamp_rect(
        {"x": core["x"] - band, "y": core["y"] - band, "w": core["w"] + band * 2, "h": core["h"] + band * 2},
        doc_w,
        doc_h,
    )
    return {
        "seamDoc": seam,
        "growDoc": grow,
        "seamGen": max(0, int(round(seam * scale))),
        "inpaintGen": max(0, int(round((seam + grow) * scale))),
        "scale": scale,
        "crop": crop,
        "blend": blend,
        "gen": gen,
        "placed": placed,
    }


def inverse_box(img_w: int, img_h: int, placed: dict, gen_w: int, gen_h: int) -> tuple[int, int, int, int]:
    """Integer source rect of the letterboxed content inside a model image."""
    sx = int(round(placed["x"] * img_w / max(1, gen_w)))
    sy = int(round(placed["y"] * img_h / max(1, gen_h)))
    sw = max(1, int(round(placed["w"] * img_w / max(1, gen_w))))
    sh = max(1, int(round(placed["h"] * img_h / max(1, gen_h))))
    return sx, sy, sw, sh
