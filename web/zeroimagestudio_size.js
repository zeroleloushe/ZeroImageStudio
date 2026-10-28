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
    cropSizeToStep: cropSizeToStep,
    containInside: containInside,
    CREATE_ASPECTS: CREATE_ASPECTS,
    resolutionCatalog: resolutionCatalog,
  };
});
