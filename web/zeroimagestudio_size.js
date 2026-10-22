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

  function areaLabelText(gen, doc, area) {
    const frame = generationFrame(doc, area);
    const kind = area && area.userPlaced ? "Область" : "Весь холст";
    const w = Math.round((gen && gen.w) || 0);
    const h = Math.round((gen && gen.h) || 0);
    return kind + " " + w + "×" + h + " → " + frame.w + "×" + frame.h;
  }

  return { snapSize: snapSize, generationFrame: generationFrame, areaStatusText: areaStatusText, areaLabelText: areaLabelText };
});
