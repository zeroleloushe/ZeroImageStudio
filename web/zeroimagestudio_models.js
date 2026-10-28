/* Per-model memory. Classic script in the editor, require() in tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZeroImageStudioModels = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  const FILE_KEYS = ["unet", "clip", "vae", "checkpoint"];
  const SHARED = ["loader", "clip_type", "weight_dtype", "latent_mode", "qwen_resolution", "encoder"].concat(FILE_KEYS);
  const SAMPLER_KEYS = ["steps", "cfg", "denoise", "sampler", "scheduler", "batch", "seedMode", "seed"];
  const KREA_KEYS = ["task", "fit_mode", "grounding_px", "impl", "ref_boost", "ref_boost_a"];

  function cloneLoras(list) {
    return (list || []).filter((l) => l && !l.system && l.role !== "task").slice(0, 30).map((l) => ({
      name: String(l.name || ""),
      strength_model: Number(l.strength_model) || 0,
      strength_clip: Number(l.strength_clip) || 0,
      enabled: l.enabled !== false,
      trigger_mode: l.trigger_mode || "off",
      triggers: Array.isArray(l.triggers) ? l.triggers.slice(0, 40) : [],
    })).filter((l) => l.name);
  }

  function cloneSampler(sampler) {
    const out = {};
    for (const key of SAMPLER_KEYS) if (sampler && sampler[key] != null) out[key] = sampler[key];
    return out;
  }

  function capture(pipe, pipeline, sampler) {
    const slot = { loras: cloneLoras(pipe && pipe.loras), sampler: cloneSampler(sampler) };
    for (const key of SHARED) if (pipe && pipe[key] != null) slot[key] = pipe[key];
    if (pipeline === "edit" && pipe) {
      slot.method = pipe.method;
      slot.inpaint_mode = pipe.inpaint_mode;
      slot.inpaint_grow = pipe.inpaint_grow;
      if (pipe.method === "krea2_edit" && pipe.krea) {
        slot.krea = {};
        for (const key of KREA_KEYS) if (pipe.krea[key] != null) slot.krea[key] = pipe.krea[key];
      }
    }
    return slot;
  }

  function writeSampler(target, saved) {
    if (!target || !saved) return;
    for (const key of SAMPLER_KEYS) if (saved[key] != null) target[key] = saved[key];
  }

  function fresh(pipe, pipeline, hint, sampler) {
    const defaults = (hint && hint.defaults) || {};
    for (const key of SHARED) pipe[key] = defaults[key] != null ? defaults[key] : "";
    if (!pipe.loader) pipe.loader = "diffusion";
    if (hint && hint.qwen_resolution != null) pipe.qwen_resolution = hint.qwen_resolution;
    if (pipeline === "edit") {
      pipe.method = (hint && hint.edit_method) || "inpaint";
      pipe.krea = { ...(pipe.krea || {}) };
      if (hint && hint.krea) Object.assign(pipe.krea, hint.krea);
      if (pipe.method === "krea2_edit" && !pipe.krea.task) pipe.krea.task = "general";
    }
    writeSampler(sampler, hint && hint.sampler);
    pipe.loras = [];
    if (hint && hint.lora && hint.lora.name && pipe.method !== "krea2_edit") {
      pipe.loras.push({ triggers: [], trigger_mode: "off", enabled: true, strength_model: 1, strength_clip: 1, ...hint.lora });
    }
  }

  function restore(slot, pipe, pipeline, sampler) {
    for (const key of SHARED) if (slot[key] != null) pipe[key] = slot[key];
    if (pipeline === "edit") {
      if (slot.method) pipe.method = slot.method;
      if (slot.inpaint_mode) pipe.inpaint_mode = slot.inpaint_mode;
      if (slot.inpaint_grow != null) pipe.inpaint_grow = slot.inpaint_grow;
      if (pipe.method === "krea2_edit" && slot.krea) pipe.krea = { ...(pipe.krea || {}), ...slot.krea };
    }
    writeSampler(sampler, slot.sampler);
    pipe.loras = cloneLoras(slot.loras);
  }

  function remember(store, id, pipe, pipeline, sampler) {
    const next = { ...(store || {}) };
    if (!id) return next;
    next[id] = capture(pipe, pipeline, sampler);
    return sanitizeSlots(next);
  }

  function adopt(store, id, pipe, pipeline, hint, sampler) {
    const slot = store && store[id];
    if (!slot) {
      fresh(pipe, pipeline, hint, sampler);
      return false;
    }
    restore(slot, pipe, pipeline, sampler);
    return true;
  }

  function sanitizeSlots(raw) {
    if (!raw || typeof raw !== "object") return {};
    const out = {};
    for (const key of Object.keys(raw).slice(0, 40)) out[key] = raw[key];
    return out;
  }

  return { capture, fresh, restore, remember, adopt, sanitizeSlots, cloneLoras, FILE_KEYS, SHARED, SAMPLER_KEYS };
});
