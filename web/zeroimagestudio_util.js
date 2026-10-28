/* Shared text, path and undo helpers. Classic script in the editor, require() in tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZeroImageStudioUtil = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeSlashes(name) {
    return String(name == null ? "" : name).replace(/\\/g, "/");
  }

  function basenameOf(name) {
    return fileBase(name).toLowerCase();
  }

  function fileBase(name) {
    const norm = normalizeSlashes(name);
    const slash = norm.lastIndexOf("/");
    return slash >= 0 ? norm.slice(slash + 1) : norm;
  }

  function formatApiError(body, statusText) {
    if (body == null || body === "") return statusText || "Ошибка запроса";
    if (typeof body === "string") return body.slice(0, 500);
    const parts = [];
    const nodes = body.node_errors;
    if (nodes && typeof nodes === "object") {
      for (const info of Object.values(nodes)) {
        const cls = (info && (info.class_type || info.type)) || "узел";
        const errors = (info && info.errors) || [];
        for (const err of errors) {
          const input = (err && (err.input || (err.extra_info && err.extra_info.input_name))) || "";
          const message = (err && (err.message || err.details)) || "ошибка";
          parts.push(cls + (input ? " · " + input : "") + ": " + message);
        }
      }
    }
    if (parts.length) return parts.join("; ");
    if (typeof body.error === "string") return body.error;
    if (body.error && typeof body.error.message === "string") return body.error.message;
    if (body.error) return JSON.stringify(body.error).slice(0, 500);
    return statusText || "Ошибка запроса";
  }

  function safeId(value, fallback) {
    const cleaned = String(value == null ? "" : value).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);
    return cleaned || fallback || "id";
  }

  function finiteNumber(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  // Verb stems only. \b is not Unicode-aware in JS, so the edges are letters/digits.
  const REMOVAL_RE = /(?<![\p{L}\p{N}_])(?:удали\p{L}*|убери\p{L}*|сотри\p{L}*|remove\p{L}*|erase\p{L}*|delete\p{L}*)(?![\p{L}\p{N}_])/iu;

  function requestsRemoval(text) {
    return REMOVAL_RE.test(String(text || ""));
  }

  function inverseHistory(rec, current) {
    if (!rec || !current) return null;
    if (rec.type === "full") return current.full || null;
    if (rec.type === "move") {
      return { type: "move", id: rec.id, x: current.x, y: current.y };
    }
    if (rec.type === "pixels" || rec.type === "patch") {
      return {
        type: rec.type,
        id: rec.id,
        x: rec.x,
        y: rec.y,
        w: rec.w,
        h: rec.h,
        data: current.data,
        mask: current.mask,
        maskStroke: !!rec.maskStroke,
        layerMaskId: rec.layerMaskId || "",
      };
    }
    return null;
  }

  function historyBytes(records) {
    let total = 0;
    for (const rec of records || []) total += recordBytes(rec);
    return total;
  }

  function recordBytes(rec) {
    if (!rec) return 0;
    let n = imageBytes(rec.data) + imageBytes(rec.mask);
    if (rec.type === "full" && rec.layers) {
      for (const layer of rec.layers) {
        n += imageBytes(layer && layer.data);
        n += imageBytes(layer && layer.mask && (layer.mask.data || layer.mask));
      }
    }
    return n;
  }

  function brushTargetsMask(tool, maskSelected) {
    if (tool === "mask" || tool === "maskerase") return true;
    return (tool === "brush" || tool === "eraser") && !!maskSelected;
  }

  function workMaskRowVisible(hasMask, tool, focus) {
    return !!hasMask || tool === "mask" || tool === "maskerase" || focus === "work";
  }

  // A saved task-LoRA choice wins. The suggested file is only the first visit.
  // No content yet: the first image defines the canvas. A later image keeps it.
  function importPlacement(hasContent, choice) {
    if (!hasContent) return "new";
    return choice === "grow" ? "grow" : "fit";
  }

  function presetCategory(item) {
    const name = item && String(item.category || "").trim();
    return name || "Общее";
  }

  function resolveTaskLora(saved, suggestedName) {
    const suggested = String(suggestedName || "");
    if (saved && String(saved.name || "").trim()) {
      const strength = Number(saved.strength_model);
      const clip = Number(saved.strength_clip);
      const modelStrength = Number.isFinite(strength) ? strength : 1;
      return {
        name: String(saved.name),
        strength_model: modelStrength,
        strength_clip: Number.isFinite(clip) ? clip : modelStrength,
        enabled: saved.enabled !== false,
        remembered: true,
      };
    }
    return { name: suggested, strength_model: 1, strength_clip: 1, enabled: true, remembered: false };
  }

  function maskShortcutClears(key, ctrl, focus) {
    const k = String(key || "");
    if (ctrl && k.toLowerCase() === "d") return "clear";
    if (!ctrl && (k === "Delete" || k === "Backspace") && focus === "work") return "clear";
    return "";
  }

  function imageBytes(data) {
    if (!data) return 0;
    if (data.data && data.data.byteLength) return data.data.byteLength;
    if (data.byteLength) return data.byteLength;
    return 0;
  }

  return {
    escapeHtml,
    normalizeSlashes,
    basenameOf,
    fileBase,
    formatApiError,
    safeId,
    finiteNumber,
    requestsRemoval,
    inverseHistory,
    brushTargetsMask,
    resolveTaskLora,
    presetCategory,
    importPlacement,
    workMaskRowVisible,
    maskShortcutClears,
    historyBytes,
    recordBytes,
  };
});
