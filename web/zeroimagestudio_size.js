/* Shared generation-size text. Classic script in the editor, require() in tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZeroImageStudioSize = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function snapSize(n, step, minimum) {
    const s = Math.max(1, step || 16);
    const floor = minimum == null ? 64 : minimum;
    let snapped = Math.round(Number(n) / s) * s;
    if (!Number.isFinite(snapped) || snapped < floor) snapped = Math.ceil(floor / s) * s;
    return snapped;
  }

  function generationFrame(doc, area) {
    const linked = !area || area.outputLinked !== false;
    const placed = !!(area && area.userPlaced);
    if (linked && !placed) {
      return { w: snapSize(doc && doc.w), h: snapSize(doc && doc.h) };
    }
    return {
      w: snapSize(area && area.outW),
      h: snapSize(area && area.outH),
    };
  }

  function areaStatusText(doc, area) {
    const frame = generationFrame(doc, area);
    const kind = area && area.userPlaced ? "область" : "весь холст";
    return kind + " → " + frame.w + "×" + frame.h;
  }

  function frameForRegion(srcW, srcH, budgetW, budgetH, step) {
    const s = Math.max(1, step || 16);
    const sw = Math.max(1, Number(srcW) || 1);
    const sh = Math.max(1, Number(srcH) || 1);
    const budget = Math.max(s * s, (Number(budgetW) || sw) * (Number(budgetH) || sh));
    const ratio = sw / sh;
    const h = Math.sqrt(budget / ratio);
    return { w: snapSize(h * ratio, s), h: snapSize(h, s) };
  }

  function containRect(srcW, srcH, boxW, boxH) {
    const sw = Math.max(1, Number(srcW) || 1);
    const sh = Math.max(1, Number(srcH) || 1);
    const bw = Math.max(1, Number(boxW) || 1);
    const bh = Math.max(1, Number(boxH) || 1);
    const scale = Math.min(bw / sw, bh / sh);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    return { x: Math.floor((bw - w) / 2), y: Math.floor((bh - h) / 2), w: w, h: h };
  }

  function sizeForMegapixels(w, h, mp, step) {
    const s = Math.max(1, step || 16);
    const ratio = Math.max(1, Number(w) || 1) / Math.max(1, Number(h) || 1);
    const pixels = Math.max(0.25, Number(mp) || 1) * 1e6;
    const height = Math.sqrt(pixels / ratio);
    return { w: snapSize(height * ratio, s), h: snapSize(height, s) };
  }

  function cropSizeToStep(w, h, step) {
    const s = Math.max(1, step || 16);
    const sw = Math.max(0, Math.floor((Number(w) || 0) / s) * s);
    const sh = Math.max(0, Math.floor((Number(h) || 0) / s) * s);
    return {
      w: sw >= s ? sw : Math.max(1, Math.round(Number(w) || 1)),
      h: sh >= s ? sh : Math.max(1, Math.round(Number(h) || 1)),
    };
  }

  function containInside(srcW, srcH, boxW, boxH) {
    const sw = Math.max(1, Number(srcW) || 1);
    const sh = Math.max(1, Number(srcH) || 1);
    const bw = Math.max(1, Number(boxW) || 1);
    const bh = Math.max(1, Number(boxH) || 1);
    const scale = Math.min(bw / sw, bh / sh, 1);
    const w = Math.max(1, Math.round(sw * scale));
    const h = Math.max(1, Math.round(sh * scale));
    return { x: Math.round((bw - w) / 2), y: Math.round((bh - h) / 2), w: w, h: h };
  }

  const FRAME_HANDLES = { n: 1, s: 1, e: 1, w: 1, nw: 1, ne: 1, sw: 1, se: 1 };

  function refEditDefaults(w, h) {
    return {
      crop: { x: 0, y: 0, w: Math.max(1, w), h: Math.max(1, h) },
      aspect: "free",
      rot: 0,
      flipX: false,
      flipY: false,
      straighten: 0,
    };
  }

  function refAspectRatio(aspect, frameW, frameH) {
    if (aspect === "1:1") return 1;
    if (aspect === "3:4") return 3 / 4;
    if (aspect === "4:3") return 4 / 3;
    if (aspect === "16:9") return 16 / 9;
    if (aspect === "frame") return Math.max(1, Number(frameW) || 1) / Math.max(1, Number(frameH) || 1);
    return 0;
  }

  function clampRefCrop(crop, imgW, imgH) {
    const boundsW = Math.max(1, imgW);
    const boundsH = Math.max(1, imgH);
    let x = crop.x, y = crop.y, w = crop.w, h = crop.h;
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    w = Math.max(1, Math.min(w, boundsW));
    h = Math.max(1, Math.min(h, boundsH));
    x = Math.max(0, Math.min(x, boundsW - w));
    y = Math.max(0, Math.min(y, boundsH - h));
    return { x: x, y: y, w: w, h: h };
  }

  function fitRefCrop(imgW, imgH, ratio) {
    const iw = Math.max(1, imgW);
    const ih = Math.max(1, imgH);
    if (!ratio) return { x: 0, y: 0, w: iw, h: ih };
    let w = iw;
    let h = w / ratio;
    if (h > ih) { h = ih; w = h * ratio; }
    return clampRefCrop({ x: (iw - w) / 2, y: (ih - h) / 2, w: w, h: h }, iw, ih);
  }

  function rotateRefCrop90(crop, imgW, imgH, direction) {
    const dir = direction < 0 ? -1 : 1;
    const box = clampRefCrop(crop, imgW, imgH);
    if (dir > 0) {
      return clampRefCrop({ x: box.y, y: imgW - (box.x + box.w), w: box.h, h: box.w }, imgH, imgW);
    }
    return clampRefCrop({ x: imgH - (box.y + box.h), y: box.x, w: box.h, h: box.w }, imgH, imgW);
  }

  function effectiveSeam(requested, maskW, maskH) {
    const side = Math.max(1, Math.min(Number(maskW) || 1, Number(maskH) || 1));
    const cap = Math.max(0, Math.round(side * 0.25));
    const req = Number(requested);
    if (!req) return Math.min(cap, Math.max(0, Math.round(side * 0.08)));
    return Math.min(Math.max(0, Math.round(req)), cap);
  }

  function clampRect(rect, docW, docH) {
    const dw = Math.max(1, Number(docW) || 1);
    const dh = Math.max(1, Number(docH) || 1);
    let x = Math.max(0, Math.round(rect.x || 0));
    let y = Math.max(0, Math.round(rect.y || 0));
    let x2 = Math.min(dw, Math.round((rect.x || 0) + (rect.w || 0)));
    let y2 = Math.min(dh, Math.round((rect.y || 0) + (rect.h || 0)));
    if (x2 <= x) x2 = Math.min(dw, x + 1);
    if (y2 <= y) y2 = Math.min(dh, y + 1);
    return { x: x, y: y, w: x2 - x, h: y2 - y };
  }

  function editGeometry(opts) {
    const docW = Math.max(1, Number(opts && opts.docW) || 1);
    const docH = Math.max(1, Number(opts && opts.docH) || 1);
    const frame = (opts && opts.frame) || { x: 0, y: 0, w: docW, h: docH };
    const mask = opts && opts.maskBBox;
    const seam = mask
      ? effectiveSeam(opts.seamDoc, mask.w, mask.h)
      : effectiveSeam(opts.seamDoc, frame.w, frame.h);
    const grow = Math.max(0, Math.round(Number(opts && opts.growDoc) || 0));
    const context = Math.max(0, Number(opts && opts.context) || 0);
    const band = seam + grow;
    const framed = contextRect(frame, docW, docH, context);
    const crop = clampRect({
      x: framed.x - band,
      y: framed.y - band,
      w: framed.w + band * 2,
      h: framed.h + band * 2,
    }, docW, docH);
    const core = mask || frame;
    const step = Math.max(1, Number(opts && opts.step) || 16);
    const mp = Number(opts && opts.mp) || 1;
    const budget = (opts && opts.genW && opts.genH)
      ? { w: Number(opts.genW), h: Number(opts.genH) }
      : sizeForMegapixels(crop.w, crop.h, mp, step);
    const gen = frameForRegion(crop.w, crop.h, budget.w, budget.h, step);
    const placed = containRect(crop.w, crop.h, gen.w, gen.h);
    const scale = placed.w / Math.max(1, crop.w);
    const blend = clampRect({ x: core.x - band, y: core.y - band, w: core.w + band * 2, h: core.h + band * 2 }, docW, docH);
    return {
      seamDoc: seam,
      seamRequested: Math.max(0, Math.round(Number(opts && opts.seamDoc) || 0)),
      growDoc: grow,
      seamGen: Math.max(0, Math.round(seam * scale)),
      growGen: Math.max(0, Math.round(grow * scale)),
      inpaintGen: Math.max(0, Math.round((seam + grow) * scale)),
      scale: scale,
      crop: crop,
      blend: blend,
      frame: { x: frame.x, y: frame.y, w: frame.w, h: frame.h },
      maskBBox: mask ? { x: mask.x, y: mask.y, w: mask.w, h: mask.h } : null,
      gen: gen,
      placed: placed,
    };
  }

  function contextRect(frame, docW, docH, frac) {
    const g = frame || { x: 0, y: 0, w: docW, h: docH };
    const docWidth = Math.max(1, Number(docW) || 1);
    const docHeight = Math.max(1, Number(docH) || 1);
    let x = g.x || 0;
    let y = g.y || 0;
    let w = g.w || 0;
    let h = g.h || 0;
    const expand = Number(frac) || 0;
    if (expand > 0 && w > 0 && h > 0) {
      const px = Math.round(w * expand);
      const py = Math.round(h * expand);
      const x2 = Math.min(docWidth, (g.x || 0) + w + px);
      const y2 = Math.min(docHeight, (g.y || 0) + h + py);
      x = Math.max(0, (g.x || 0) - px);
      y = Math.max(0, (g.y || 0) - py);
      w = x2 - x;
      h = y2 - y;
    }
    x = Math.round(x);
    y = Math.round(y);
    w = Math.round(w);
    h = Math.round(h);
    w = Math.max(1, Math.min(docWidth - x, w));
    h = Math.max(1, Math.min(docHeight - y, h));
    return { x: x, y: y, w: w, h: h };
  }

  function pasteSuppliesCoverage(minAlpha, maxAlpha) {
    return Number(minAlpha) < 250 && Number(maxAlpha) > Number(minAlpha);
  }

  function previewMap(crop, genW, genH, placed) {
    const box = placed || { x: 0, y: 0, w: genW, h: genH };
    const pw = Math.max(1, box.w);
    const ph = Math.max(1, box.h);
    const sx = crop.w / pw;
    const sy = crop.h / ph;
    return {
      x: crop.x - box.x * sx,
      y: crop.y - box.y * sy,
      w: Math.max(1, genW) * sx,
      h: Math.max(1, genH) * sy,
    };
  }

  function frameGesture(x, y, frame, zoom, opts) {
    const paint = !!(opts && opts.paint);
    const alt = !!(opts && opts.alt);
    const frameTool = !!(opts && opts.frameTool);
    if (!frame || !(frame.w > 0) || !(frame.h > 0)) return frameTool ? "new" : "";
    const pad = 12 / Math.max(0.05, Number(zoom) || 1);
    const x0 = frame.x;
    const y0 = frame.y;
    const x1 = frame.x + frame.w;
    const y1 = frame.y + frame.h;
    const near = x >= x0 - pad && x <= x1 + pad && y >= y0 - pad && y <= y1 + pad;
    if (!near) return frameTool ? "new" : "";
    const corners = [["nw", x0, y0], ["ne", x1, y0], ["sw", x0, y1], ["se", x1, y1]];
    for (let i = 0; i < corners.length; i++) {
      if (Math.abs(x - corners[i][1]) <= pad && Math.abs(y - corners[i][2]) <= pad) return corners[i][0];
    }
    if (Math.abs(y - y0) <= pad && x >= x0 && x <= x1) return "n";
    if (Math.abs(y - y1) <= pad && x >= x0 && x <= x1) return "s";
    if (Math.abs(x - x0) <= pad && y >= y0 && y <= y1) return "w";
    if (Math.abs(x - x1) <= pad && y >= y0 && y <= y1) return "e";
    const inside = x >= x0 && y >= y0 && x <= x1 && y <= y1;
    if (!inside) return frameTool ? "new" : "";
    if (paint && !alt) return "paint";
    if (frameTool || alt) return "move";
    return "";
  }

  function snapRect(rect, step, doc) {
    const s = Math.max(1, step || 16);
    const maxW = Math.max(s, (doc && doc.w) || 0);
    const maxH = Math.max(s, (doc && doc.h) || 0);
    let w = snapSize(rect && rect.w, s, s);
    let h = snapSize(rect && rect.h, s, s);
    if (w > maxW) w = Math.max(s, Math.floor(maxW / s) * s);
    if (h > maxH) h = Math.max(s, Math.floor(maxH / s) * s);
    let x = Math.round((rect && rect.x || 0) / s) * s;
    let y = Math.round((rect && rect.y || 0) / s) * s;
    if (x < 0) x = 0;
    if (y < 0) y = 0;
    if (x + w > maxW) x = Math.max(0, Math.floor((maxW - w) / s) * s);
    if (y + h > maxH) y = Math.max(0, Math.floor((maxH - h) / s) * s);
    return { x: x, y: y, w: w, h: h };
  }

  const CREATE_ASPECTS = [
    ["1:1", 1, 1], ["16:9", 16, 9], ["9:16", 9, 16], ["2:1", 2, 1],
    ["3:2", 3, 2], ["2:3", 2, 3], ["4:3", 4, 3], ["3:4", 3, 4], ["4:5", 4, 5],
  ];
  const NAMED_SIZES = {
    "1:1": [[512, 512], [768, 768], [1024, 1024], [1280, 1280], [1536, 1536]],
    "9:16": [[480, 832], [720, 1280], [768, 1344], [864, 1536], [1088, 1920]],
    "16:9": [[832, 480], [1280, 720], [1344, 768], [1536, 864], [1920, 1088]],
  };

  function resolutionCatalog(aspect, step, mp) {
    const hit = CREATE_ASPECTS.find((item) => item[0] === aspect) || CREATE_ASPECTS[0];
    const ratio = hit[1] / hit[2];
    const s = Math.max(1, step || 16);
    const named = (NAMED_SIZES[hit[0]] || []).map(([w, h]) => ({ w: w, h: h }));
    const gen = [];
    for (let h0 = 480; h0 <= 1920; h0 += 64) {
      const h = snapSize(h0, s, s);
      const w = snapSize(h * ratio, s, s);
      if (Math.abs(w / h - ratio) / ratio > 0.035) continue;
      if (named.some((n) => Math.abs(n.w - w) <= 32 && Math.abs(n.h - h) <= 32)) continue;
      if (gen.some((item) => item.w === w && item.h === h)) continue;
      gen.push({ w: w, h: h });
    }
    const seen = new Set();
    let all = named.concat(gen).filter((item) => {
      const key = item.w + "x" + item.h;
      if (seen.has(key)) return false;
      seen.add(key);
      return item.w % s === 0 && item.h % s === 0;
    });
    all.sort((a, b) => a.w * a.h - b.w * b.h);
    if (mp == null || mp === "") return all;
    const target = Number(mp);
    if (!Number.isFinite(target)) return all;
    const filtered = all.filter((item) => Math.abs((item.w * item.h) / 1e6 - target) <= 0.28);
    return filtered.length ? filtered : all.slice(0, 8);
  }

  function areaLabelText(gen, doc, area) {
    const frame = generationFrame(doc, area);
    const kind = area && area.userPlaced ? "Область" : "Весь холст";
    const w = Math.round((gen && gen.w) || 0);
    const h = Math.round((gen && gen.h) || 0);
    return kind + " " + w + "×" + h + " → " + frame.w + "×" + frame.h;
  }

  return {
    snapSize: snapSize,
    generationFrame: generationFrame,
    frameForRegion: frameForRegion,
    containRect: containRect,
    areaStatusText: areaStatusText,
    areaLabelText: areaLabelText,
    sizeForMegapixels: sizeForMegapixels,
    snapRect: snapRect,
    frameGesture: frameGesture,
    contextRect: contextRect,
    effectiveSeam: effectiveSeam,
    refEditDefaults: refEditDefaults,
    refAspectRatio: refAspectRatio,
    clampRefCrop: clampRefCrop,
    fitRefCrop: fitRefCrop,
    rotateRefCrop90: rotateRefCrop90,
    editGeometry: editGeometry,
    previewMap: previewMap,
    pasteSuppliesCoverage: pasteSuppliesCoverage,
    FRAME_HANDLES: FRAME_HANDLES,
    cropSizeToStep: cropSizeToStep,
    containInside: containInside,
    CREATE_ASPECTS: CREATE_ASPECTS,
    resolutionCatalog: resolutionCatalog,
  };
});
