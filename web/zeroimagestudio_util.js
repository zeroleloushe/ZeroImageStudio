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

  function loraDisplay(name) {
    const base = fileBase(name);
    const ext = (base.match(/\.([^.]+)$/) || [])[1] || "";
    const label = base.replace(/\.(safetensors|sft|pt|ckpt|bin)$/i, "");
    return { label: label || base, ext: ext.toLowerCase(), title: normalizeSlashes(name) };
  }

  function loraPreviewCandidates(name) {
    const norm = normalizeSlashes(name);
    const slash = norm.lastIndexOf("/");
    const dir = slash >= 0 ? norm.slice(0, slash + 1) : "";
    const file = slash >= 0 ? norm.slice(slash + 1) : norm;
    const dot = file.lastIndexOf(".");
    const stem = dot > 0 ? file.slice(0, dot) : file;
    return [".preview.png", ".png", ".jpg", ".jpeg", ".webp"].map((ext) => dir + stem + ext);
  }

  function matchSidecar(name, names) {
    const have = new Set((names || []).map((item) => normalizeSlashes(item).toLowerCase()));
    for (const candidate of loraPreviewCandidates(name)) {
      if (have.has(candidate.toLowerCase())) return candidate;
    }
    return "";
  }

  function parentFolder(path) {
    const norm = normalizeSlashes(path).replace(/\/+$/, "");
    const slash = norm.lastIndexOf("/");
    return slash >= 0 ? norm.slice(0, slash) : "";
  }

  function isSidecarImage(name) {
    return /\.(png|jpe?g|webp)$/i.test(normalizeSlashes(name));
  }

  function prepareLoraListing(opts) {
    const files = opts && opts.files || [];
    const weights = files.filter((name) => !isSidecarImage(name));
    const path = normalizeSlashes((opts && opts.path) || "").replace(/^\/+|\/+$/g, "");
    const query = String((opts && opts.query) || "").trim().toLowerCase();
    const previews = (opts && opts.previews) || {};
    const remote = (opts && opts.remote) || {};
    const added = new Set(opts && opts.added || []);
    const previewUrl = (opts && opts.previewUrl) || ((rel) => rel);
    const fileItem = (raw) => {
      const norm = normalizeSlashes(raw);
      const side = previews[norm] || previews[raw] || matchSidecar(norm, files);
      const preview = side ? previewUrl(side) : (remote[norm] || remote[raw] || "");
      const display = loraDisplay(raw);
      return {
        kind: "file",
        name: raw,
        label: display.label,
        ext: display.ext,
        title: display.title,
        preview: preview,
        added: added.has(raw) || added.has(norm),
      };
    };
    if (query) {
      return weights.filter((name) => normalizeSlashes(name).toLowerCase().includes(query)).sort().map(fileItem);
    }
    const prefix = path ? path + "/" : "";
    const folders = new Set();
    const here = [];
    for (const raw of weights) {
      const name = normalizeSlashes(raw);
      if (prefix && name !== prefix.slice(0, -1) && !name.startsWith(prefix)) continue;
      const rest = prefix ? name.slice(prefix.length) : name;
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(rest.slice(0, slash));
      else if (rest) here.push(raw);
    }
    const folderItems = [...folders].sort((a, b) => a.localeCompare(b)).map((folder) => {
      const next = prefix + folder;
      const count = weights.filter((name) => normalizeSlashes(name).startsWith(next + "/")).length;
      return { kind: "folder", label: folder, enter: next, meta: count ? "папка · " + count : "папка", count: count };
    });
    return folderItems.concat(here.sort((a, b) => normalizeSlashes(a).localeCompare(normalizeSlashes(b))).map(fileItem));
  }

  function loraPickerItemsHtml(items, escapeHtmlFn) {
    const esc = escapeHtmlFn || escapeHtml;
    return (items || []).map((item) => {
      if (item.kind === "folder") {
        return `<button type="button" class="lora-dir" data-enter="${esc(item.enter)}"><span class="lora-ph" data-i="folder" data-s="18"></span><span class="nm">${esc(item.label)}</span><span class="mu">${esc(item.meta)}</span></button>`;
      }
      const thumb = item.preview
        ? `<img src="${esc(item.preview)}" alt="">`
        : `<span class="lora-ph" data-i="lora" data-s="18"></span>`;
      const ext = item.ext ? `<span class="ext">${esc(item.ext)}</span>` : "";
      const mark = item.added ? `<span class="tag">Добавлена</span>` : "";
      return `<button type="button" class="lora-file" data-pick="${esc(item.name)}">${thumb}<span class="nm" title="${esc(item.title)}">${esc(item.label)}</span>${ext}${mark}</button>`;
    }).join("");
  }

  function nextVariantIndex(index, count, key) {
    const n = Math.max(0, Number(count) || 0);
    if (!n) return 0;
    const i = ((Number(index) || 0) % n + n) % n;
    if (key === "ArrowRight") return (i + 1) % n;
    if (key === "ArrowLeft") return (i - 1 + n) % n;
    if (/^[1-9]$/.test(String(key || ""))) {
      const pick = Number(key) - 1;
      return pick < n ? pick : i;
    }
    return i;
  }

  function loraPickerHtml(view) {
    const path = normalizeSlashes((view && view.path) || "");
    const items = (view && view.items) || [];
    const folders = items.filter((item) => item.kind === "folder").length;
    const files = items.length - folders;
    const parts = path ? path.split("/").filter(Boolean) : [];
    let acc = "";
    const crumbs = [`<button type="button" class="b s" data-crumb="">loras</button>`].concat(parts.map((part) => {
      acc = acc ? acc + "/" + part : part;
      return `<button type="button" class="b s" data-crumb="${escapeHtml(acc)}">${escapeHtml(part)}</button>`;
    })).join("");
    const back = path ? `<button type="button" class="b s" data-crumb="${escapeHtml(parentFolder(path))}">Назад</button>` : "";
    const query = (view && view.query) || "";
    return `<input id="lora-pick-search" class="f" style="width:100%;font-family:inherit" placeholder="Поиск по всем папкам" value="${escapeHtml(query)}">
      <div class="lora-crumbs">${back}${crumbs}</div>
      <div class="lora-pick-list">${loraPickerItemsHtml(items) || `<div class="empty">В этой папке пусто.</div>`}</div>
      <div class="mu" id="lora-pick-status">папки ${folders} · файлы ${files}</div>`;
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

  function layerMoveIndex(index, count, where) {
    const n = Math.max(0, Number(count) || 0);
    const i = Number(index);
    if (!n || !Number.isFinite(i) || i < 0 || i >= n) return i;
    if (where === "up") return Math.min(n - 1, i + 1);
    if (where === "down") return Math.max(0, i - 1);
    if (where === "top") return n - 1;
    if (where === "bottom") return 0;
    return i;
  }

  function shortcutToken(event) {
    if (!event) return "";
    const code = String(event.code || "");
    if (code.length === 4 && code.slice(0, 3) === "Key") {
      const letter = code.charAt(3);
      if (letter >= "A" && letter <= "Z") return letter.toLowerCase();
    }
    if (/^Digit[0-9]$/.test(code)) return code.charAt(5);
    if (code === "BracketLeft") return "[";
    if (code === "BracketRight") return "]";
    const key = String(event.key || "");
    if (!key) return "";
    if (key.length === 1 && /[a-zA-Zа-яА-ЯёЁ]/.test(key)) return "";
    return key;
  }

  function layerArrangeCommand(event) {
    if (!event || event.altKey || !(event.ctrlKey || event.metaKey)) return "";
    if (event.code === "BracketRight") return event.shiftKey ? "top" : "up";
    if (event.code === "BracketLeft") return event.shiftKey ? "bottom" : "down";
    return "";
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
    loraDisplay,
    loraPreviewCandidates,
    matchSidecar,
    parentFolder,
    prepareLoraListing,
    loraPickerItemsHtml,
    loraPickerHtml,
    nextVariantIndex,
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
    layerMoveIndex,
    layerArrangeCommand,
    shortcutToken,
    historyBytes,
    recordBytes,
  };
});
