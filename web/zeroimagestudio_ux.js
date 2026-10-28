/* UX rules for references, placement, denoise and the Krea preview. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZeroImageStudioUx = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  function refBadge(ctx, index) {
    const pipeline = ctx && ctx.pipeline;
    const method = ctx && ctx.method;
    const task = ctx && ctx.task;
    if (pipeline !== "edit") {
      return { label: "Только для LLM", used: true, reason: "В режиме Создание референс уходит только в LLM, не в модель." };
    }
    if (method === "krea2_edit" && task === "identity") {
      if (index === 0) return { label: "Человек", used: true, reason: "Первый референс — человек. Сцена берётся с холста." };
      return { label: "Не используется", used: false, reason: "Персонаж по референсу берёт только первый референс." };
    }
    if (method === "krea2_edit") {
      return { label: "Не используется", used: false, reason: "Правка Krea не отправляет дополнительные референсы." };
    }
    if (method === "qwen_image_21" || method === "qwen" || method === "qwen_image") {
      return { label: "Сцена", used: true, reason: "Кадр уходит в модель. В промте его можно назвать <image" + (index + 1) + ">." };
    }
    return { label: "Только для LLM", used: true, reason: "В этой правке референс не уходит в модель, только в LLM." };
  }

  function refStatus(ctx) {
    const n = Number(ctx && ctx.count) || 0;
    if (!ctx || ctx.pipeline !== "edit") {
      return { line: "Только для LLM · " + n, detail: "В режиме Создание референсы не идут в модель. Их берут «Описать» и «Улучшить»." };
    }
    if (ctx.method === "krea2_edit" && ctx.task === "identity") {
      return { line: "Сцена — холст, человек — первый референс · " + n, detail: "Лишние референсы не отправляются." };
    }
    if (ctx.method === "krea2_edit") {
      return { line: "Референсы не идут в модель · " + n, detail: "Правка Krea берёт только холст." };
    }
    if (ctx.method === "qwen_image_21" || ctx.method === "qwen" || ctx.method === "qwen_image") {
      return { line: "Идут в модель · " + n, detail: "До 16 кадров, в промте <image1> и дальше." };
    }
    return { line: "Только для LLM · " + n, detail: "Кроп холста идёт в модель. Эти кадры — для LLM." };
  }

  function resultPlacement(pipeline, wholeCanvas, choice) {
    if (choice === "layer" || choice === "replace") return choice;
    if (pipeline === "create" && wholeCanvas) return "replace";
    return "layer";
  }

  function effectiveDenoise(ctx) {
    const denoise = Number(ctx && ctx.denoise);
    const value = Number.isFinite(denoise) ? denoise : 1;
    if (ctx && ctx.method === "krea2_edit") {
      return { value: 1, locked: true, note: "Krea всегда семплирует с шумом 1. Маска ограничивает только вклейку, модель её не видит." };
    }
    if (ctx && ctx.method === "inpaint" && !ctx.hasMask && value >= 0.999) {
      return { value: 0.75, locked: false, note: "Маски нет: в граф уйдёт шум 0.75 (img2img), не 1." };
    }
    return { value: value, locked: false, note: "" };
  }

  function showNegative(cfg) {
    return Number(cfg) > 1;
  }

  function kreaVision(ctx) {
    const srcW = Math.max(1, Number(ctx && ctx.srcW) || 1);
    const srcH = Math.max(1, Number(ctx && ctx.srcH) || 1);
    const grounding = Math.max(64, Number(ctx && ctx.grounding) || 768);
    const scale = Math.min(1, grounding / Math.max(srcW, srcH));
    const position = String((ctx && ctx.position) || "");
    return {
      cropW: Math.max(1, Math.round(srcW * scale)),
      cropH: Math.max(1, Math.round(srcH * scale)),
      grounding: grounding,
      beside: position.indexOf("beside") >= 0,
      place: position.indexOf("beside") >= 0 ? "справа от кадра" : "поверх кадра",
      finalW: Math.round(Number(ctx && ctx.outW) || srcW),
      finalH: Math.round(Number(ctx && ctx.outH) || srcH),
    };
  }

  function singleFile(current, files) {
    if (String(current || "").trim()) return current;
    const list = (files || []).filter((name) => String(name || "").trim());
    return list.length === 1 ? list[0] : (current || "");
  }

  function blockItems(ctx) {
    const out = [];
    const c = ctx || {};
    if (!String(c.prompt || "").trim()) out.push("нет промта");
    if (c.pipeline === "edit" && c.method === "krea2_edit" && c.task === "identity") {
      if (!c.scene && !c.refs) out.push("нет сцены или референса человека");
      else if (c.scene && !c.refs) out.push("нет референса человека");
    } else if (c.pipeline === "edit" && !c.scene) out.push("нет изображения");
    if (c.loader === "checkpoint") {
      if (!String(c.checkpoint || "").trim()) out.push("нет чекпоинта");
    } else {
      if (!String(c.unet || "").trim()) out.push("нет UNET");
      if (!String(c.clip || "").trim()) out.push("нет CLIP");
      if (!String(c.vae || "").trim()) out.push("нет VAE");
    }
    if (c.missingLora) out.push("нет LoRA");
    return out;
  }

  function modelMark(meta) {
    const m = meta || {};
    if (m.edit_method === "krea2_edit" || m.pipeline === "krea") return { letter: "K", title: "Krea" };
    if (String(m.edit_method || "").indexOf("qwen") === 0 || String(m.model_label || "").indexOf("Qwen") >= 0) return { letter: "Q", title: "Qwen" };
    return { letter: "С", title: "Создание" };
  }

  const TAG_TIPS = {
    edit: "Режим правки изображения",
    "2 режима": "Два подрежима: правка и персонаж по референсу",
    "refs ≤1": "В модель уходит не больше одного референса",
    "refs ≤16": "В модель можно отдать до 16 референсов",
    t2i: "Генерация по тексту, без исходного кадра",
    fp8: "Веса в формате fp8",
    bf16: "Веса в формате bf16",
  };

  return {
    refBadge: refBadge,
    refStatus: refStatus,
    resultPlacement: resultPlacement,
    effectiveDenoise: effectiveDenoise,
    showNegative: showNegative,
    kreaVision: kreaVision,
    singleFile: singleFile,
    blockItems: blockItems,
    modelMark: modelMark,
    TAG_TIPS: TAG_TIPS,
  };
});
