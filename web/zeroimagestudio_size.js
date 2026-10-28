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
  };
});
