/* ZeroImageStudio — холст, слои, два пайплайна. Runs inside zeroimagestudio.html.
   If ComfyUI imports this file as an extension, the guard below makes it a no-op. */
(function () {
  if (!window.__ZEROIMAGESTUDIO_PAGE) return;

  const $ = (id) => document.getElementById(id);
  const U = window.ZeroImageStudioUtil;
  const HISTORY_BYTES = 32 * 1024 * 1024;
  const BLENDS = [
    ["normal", "Нормальный"], ["multiply", "Умножение"], ["screen", "Экран"],
    ["overlay", "Перекрытие"], ["soft-light", "Мягкий свет"], ["hard-light", "Жёсткий свет"],
    ["darken", "Затемнение"], ["lighten", "Осветление"], ["color-dodge", "Осветление основы"],
    ["color-burn", "Затемнение основы"], ["difference", "Разница"], ["exclusion", "Исключение"],
  ];
  const state = {
    projectId: null,
    projectName: "Новый проект",
    pipeline: "edit",
    hintId: "krea2_identity_edit",
    hintByMode: { create: "krea2", edit: "krea2_identity_edit" },
    prompt: "",
    negative: "",
    promptPresets: [
      { id: "p1", name: "Портрет-студия", category: "Портрет", text: "студийный портрет, мягкий свет, резкий фокус", position: "before", enabled: false, order: 0 },
      { id: "p2", name: "Детализация кожи 8k", category: "Детализация", text: "детальная кожа, естественные поры", position: "after", enabled: false, order: 1 },
      { id: "p3", name: "Плёнка Kodak", category: "Плёнка", text: "плёночное зерно, kodak portra", position: "after", enabled: false, order: 2 },
    ],
    sampler: { seed: 0, seedMode: "random", steps: 28, cfg: 3.5, denoise: 0.72, sampler: "euler", scheduler: "simple", batch: 1 },
    dirty: false,
    create: blankPipe("create"),
    edit: blankPipe("edit"),
    references: [],
    area: { outW: 1024, outH: 1024, aspect: "free", context: 0.15, feather: 48, paste: "poisson", colorMatch: true, userPlaced: false, outputLinked: true, mp: 1, pasteOpen: false, editScope: "full", region: null, exactOpen: false },
    tool: "genarea",
    color: "#e7c27a",
    brush: { size: 64, hardness: 0.3, opacity: 1 },
    hints: [],
    catalog: null,
    loras: [],
    loraFolder: "",
    loraQuery: "",
    loraSelected: "",
    loraBrowse: "",
    loraPickQuery: "",
    presets: [],
    gallery: [],
    galleryScope: "all",
    galleryKind: "gens",
    assets: [],
    layout: null,
    settings: null,
    running: false,
    promptId: null,
    jobId: "",
    galleryTotal: 0,
    galleryLimit: 48,
    studioPaused: false,
    collapsed: false,
    maskFocus: null,
    workMaskHidden: false,
    kreaTaskSlots: {},
  };
  state.edit.method = "krea2_edit";
  state.edit.clip_type = "krea2";

  const KREA_TASKS = {
    general: {
      file: "krea2_general_edit_v2.safetensors",
      url: "https://huggingface.co/conradlocke/krea2-identity-edit/blob/main/krea2_general_edit_v2.safetensors",
      grounding: 768,
    },
    identity: {
      file: "krea2_identity_edit_v2.safetensors",
      url: "https://huggingface.co/conradlocke/krea2-identity-edit/blob/main/krea2_identity_edit_v2.safetensors",
      grounding: 1024,
    },
  };
  const MODEL_DOWNLOADS = [
    {
      title: "Krea 2",
      files: [
        { name: "krea2_turbo_fp8_scaled.safetensors", folder: "models/diffusion_models/", kind: "unets", url: "https://huggingface.co/Comfy-Org/Krea-2/blob/main/diffusion_models/krea2_turbo_fp8_scaled.safetensors" },
        { name: "qwen3vl_4b_fp8_scaled.safetensors", folder: "models/text_encoders/", kind: "clips", url: "https://huggingface.co/Comfy-Org/Krea-2/blob/main/text_encoders/qwen3vl_4b_fp8_scaled.safetensors" },
        { name: "qwen_image_vae.safetensors", folder: "models/vae/", kind: "vaes", url: "https://huggingface.co/Comfy-Org/Krea-2/blob/main/vae/qwen_image_vae.safetensors" },
      ],
    },
    {
      title: "Krea 2 Edit V2",
      note: "База — те же UNET, CLIP и VAE, что у Krea 2. Для правки нужна LoRA выбранного режима.",
      files: [
        { name: KREA_TASKS.general.file, folder: "models/loras/", kind: "loras", url: KREA_TASKS.general.url },
        { name: KREA_TASKS.identity.file, folder: "models/loras/", kind: "loras", url: KREA_TASKS.identity.url },
      ],
    },
    {
      title: "Qwen Image 2.1",
      files: [
        { name: "qwen_image_2.1_bf16.safetensors", folder: "models/diffusion_models/", kind: "unets", url: "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/blob/main/diffusion_models/qwen_image_2.1_bf16.safetensors" },
        { name: "qwen3vl_8b_bf16.safetensors", folder: "models/text_encoders/", kind: "clips", url: "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/blob/main/text_encoders/qwen3vl_8b_bf16.safetensors" },
        { name: "qwen_image_2.1_vae_bf16.safetensors", folder: "models/vae/", kind: "vaes", url: "https://huggingface.co/Comfy-Org/Qwen-Image-2.1/blob/main/vae/qwen_image_2.1_vae_bf16.safetensors" },
      ],
    },
  ];
  const RECENT_KEY = "zeroimagestudio.recent";
  const PANEL_LABELS = {
    model: "Модель", refs: "Референсы", lora: "LoRA", sampler: "Генерация",
    prompt: "Промт", inspector: "Инспектор", layers: "Слои", gallery: "Галерея",
  };

  function blankPipe(kind) {
    return {
      loader: "diffusion", checkpoint: "", unet: "", clip: "", vae: "",
      clip_type: kind === "edit" ? "krea2" : "stable_diffusion",
      weight_dtype: "default", latent_mode: "sd3", encoder: "clip",
      method: "inpaint", inpaint_mode: "vae_encode", inpaint_grow: 6,
      qwen_resolution: 0,
      loras: [],
      krea: {
        fit_mode: "fit", ref_boost: 1, ref_boost_a: 1,
        ref_position: "aligned (trained)", ref_position_a: "aligned (trained)",
        grounding_px: 768, impl: "internal",
      },
    };
  }
  const cfg = () => (state.pipeline === "edit" ? state.edit : state.create);

  const clientId = (crypto.randomUUID && crypto.randomUUID()) || ("zeroimagestudio-" + Date.now());
  let ws = null;
  let wsWait = null;

  function toast(text, opts) {
    const el = $("toast");
    el.hidden = false;
    el.replaceChildren();
    const span = document.createElement("span");
    span.textContent = text;
    el.appendChild(span);
    const open = opts && opts.openModels || /не выбран/i.test(text || "");
    if (open) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "b s";
      b.textContent = "Открыть модели";
      b.onclick = () => openModelDrawer();
      el.appendChild(b);
    }
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; el.replaceChildren(); }, open ? 9000 : 5200);
  }

  function formatApiError(body, statusText) {
    return U.formatApiError(body, statusText);
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const type = res.headers.get("content-type") || "";
    const body = type.includes("json") ? await res.json() : await res.text();
    if (!res.ok) throw new Error(formatApiError(body, res.statusText));
    return body;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        if (typeof src === "string" && src.startsWith("blob:")) URL.revokeObjectURL(src);
        resolve(img);
      };
      img.onerror = () => {
        if (typeof src === "string" && src.startsWith("blob:")) URL.revokeObjectURL(src);
        reject(new Error("Не удалось открыть изображение"));
      };
      img.src = src;
    });
  }

  class Editor {
    constructor(stage) {
      this.stage = stage;
      this.canvas = document.createElement("canvas");
      this.canvas.className = "viewcanvas";
      this.stage.appendChild(this.canvas);
      this.overlay = document.createElement("div");
      this.overlay.className = "ov";
      this.overlay.innerHTML =
        '<div class="ga" id="ga"><div class="lab" data-h="move"></div>' +
        '<div class="rim" data-h="move"><i></i><i></i><i></i><i></i></div>' +
        '<div class="hd edge" data-h="n"></div><div class="hd edge" data-h="s"></div>' +
        '<div class="hd edge" data-h="e"></div><div class="hd edge" data-h="w"></div>' +
        '<div class="hd" data-h="nw"></div><div class="hd" data-h="ne"></div>' +
        '<div class="hd" data-h="sw"></div><div class="hd" data-h="se"></div></div>';
      this.stage.appendChild(this.overlay);
      this.runBox = document.createElement("div");
      this.runBox.className = "ga-run";
      this.runBox.id = "ga-run";
      this.runBox.hidden = true;
      this.runBox.innerHTML = '<img id="ga-preview" alt=""><div id="ga-run-label">В очереди</div><button type="button" class="b" id="btn-cancel">Отмена</button>';
      this.stage.appendChild(this.runBox);
      this.ga = this.overlay.querySelector(".ga");
      this.doc = { w: 1024, h: 1024 };
      this.layers = [];
      this.active = 0;
      this.zoom = 1;
      this.panX = 40;
      this.panY = 30;
      this.gen = { x: 0, y: 0, w: 1024, h: 1024 };
      this._viewW = 0;
      this._viewH = 0;
      this.maskCanvas = document.createElement("canvas");
      this.maskCtx = null;
      this.selection = null;
      this.undoStack = [];
      this.redoStack = [];
      this._maskCount = 0;
      this._maskDirty = true;
      this._maskLive = false;
      this.space = false;
      this.drag = null;
      this._raf = 0;
      this.resizeMask();
      this.bind();
      this.resizeView();
      new ResizeObserver(() => {
        const r = this.stage.getBoundingClientRect();
        const changed = Math.abs(r.width - this._viewW) > 1 || Math.abs(r.height - this._viewH) > 1;
        this.resizeView();
        if (changed && r.width > 20 && r.height > 20) {
          this._viewW = r.width;
          this._viewH = r.height;
          this.fit();
        }
      }).observe(stage);
    }

    resizeMask() {
      const prev = this.maskCanvas;
      const c = document.createElement("canvas");
      c.width = this.doc.w;
      c.height = this.doc.h;
      const g = c.getContext("2d");
      if (this.maskCtx) g.drawImage(prev, 0, 0);
      this.maskCanvas = c;
      this.maskCtx = g;
      this.touchMask();
    }

    resizeView() {
      const r = this.stage.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.max(1, Math.floor(r.width * dpr));
      this.canvas.height = Math.max(1, Math.floor(r.height * dpr));
      this.requestDraw();
    }

    requestDraw() {
      if (this._raf) return;
      this._raf = requestAnimationFrame(() => { this._raf = 0; this.draw(); });
    }

    fit() {
      const r = this.stage.getBoundingClientRect();
      const pad = 48;
      const zw = (r.width - pad) / this.doc.w;
      const zh = (r.height - pad) / this.doc.h;
      this.zoom = Math.max(0.05, Math.min(zw, zh, 8));
      this.panX = (r.width - this.doc.w * this.zoom) / 2;
      this.panY = (r.height - this.doc.h * this.zoom) / 2;
      this.requestDraw();
    }

    zoom100() {
      const r = this.stage.getBoundingClientRect();
      this.zoom = 1;
      this.panX = (r.width - this.doc.w) / 2;
      this.panY = (r.height - this.doc.h) / 2;
      this.requestDraw();
    }

    zoomBy(factor, cx, cy) {
      const before = this.screenToDoc(cx, cy);
      this.zoom = Math.min(8, Math.max(0.05, this.zoom * factor));
      const r = this.canvas.getBoundingClientRect();
      this.panX = cx - r.left - before.x * this.zoom;
      this.panY = cy - r.top - before.y * this.zoom;
      this.requestDraw();
    }

    screenToDoc(cx, cy) {
      const r = this.canvas.getBoundingClientRect();
      return { x: (cx - r.left - this.panX) / this.zoom, y: (cy - r.top - this.panY) / this.zoom };
    }

    activeLayer() { return this.layers[this.active] || null; }

    makeLayer(name, canvas) {
      const c = canvas || document.createElement("canvas");
      if (!canvas) { c.width = this.doc.w; c.height = this.doc.h; }
      return {
        id: "l" + Math.random().toString(36).slice(2, 8),
        name, canvas: c, ctx: c.getContext("2d"),
        x: 0, y: 0, visible: true, opacity: 1, blend: "normal",
        locked: false, rotation: 0, scaleX: 1, scaleY: 1, meta: null, thumb: "",
        mask: null, maskThumb: "",
      };
    }

    addLayer(layer, select = true) {
      this.layers.push(layer);
      if (select) this.active = this.layers.length - 1;
      this.thumb(layer);
      this.requestDraw();
      renderLayers();
    }

    async addImage(img, opts = {}) {
      const c = document.createElement("canvas");
      c.width = opts.w || img.naturalWidth || img.width;
      c.height = opts.h || img.naturalHeight || img.height;
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      const layer = this.makeLayer(opts.name || "Слой", c);
      layer.x = opts.x || 0;
      layer.y = opts.y || 0;
      layer.meta = opts.meta || null;
      layer.locked = !!opts.locked;
      layer.opacity = opts.opacity ?? 1;
      layer.blend = opts.blend || "normal";
      layer.visible = opts.visible !== false;
      this.addLayer(layer);
      return layer;
    }

    draw() {
      const ctx = this.canvas.getContext("2d");
      const dpr = window.devicePixelRatio || 1;
      const w = this.canvas.width / dpr;
      const h = this.canvas.height / dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.save();
      ctx.translate(this.panX, this.panY);
      ctx.scale(this.zoom, this.zoom);
      ctx.fillStyle = "#1c2028";
      ctx.fillRect(0, 0, this.doc.w, this.doc.h);
      ctx.strokeStyle = "#c5ccd8";
      ctx.lineWidth = Math.max(1, 1 / this.zoom);
      ctx.strokeRect(0.5, 0.5, this.doc.w - 1, this.doc.h - 1);
      let first = true;
      for (const layer of this.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = first || layer.blend === "normal" ? "source-over" : layer.blend;
        first = false;
        ctx.translate(layer.x, layer.y);
        ctx.rotate(layer.rotation || 0);
        ctx.scale(layer.scaleX || 1, layer.scaleY || 1);
        ctx.drawImage(this.composited(layer), 0, 0);
        ctx.restore();
      }
      if ((this._maskLive || !state.workMaskHidden) && (this._maskLive || this.maskArea() > 0)) {
        ctx.save();
        ctx.globalAlpha = 0.42;
        ctx.drawImage(this.maskTint(), 0, 0);
        ctx.restore();
      }
      if (state.maskFocus && state.maskFocus.id) {
        const masked = this.layers.find((l) => l.id === state.maskFocus.id && l.mask);
        if (masked) {
          ctx.save();
          ctx.globalAlpha = 0.42;
          ctx.translate(masked.x, masked.y);
          ctx.rotate(masked.rotation || 0);
          ctx.scale(masked.scaleX || 1, masked.scaleY || 1);
          ctx.drawImage(this.greenTint(masked.mask.canvas), 0, 0);
          ctx.restore();
        }
      }
      if (this.selection) this.strokeSelection(ctx);
      ctx.restore();
      this.placeGen();
      const info = $("canvas-info");
      if (info) {
        info.textContent = `${this.doc.w}×${this.doc.h}`;
        info.title = `${this.doc.w} × ${this.doc.h} · RGB 8 бит`;
      }
      const zoom = $("zoom-readout");
      if (zoom) zoom.textContent = Math.round(this.zoom * 100) + "%";
    }

    composited(layer) {
      if (!layer || !layer.mask || layer.mask.visible === false) return layer.canvas;
      const c = document.createElement("canvas");
      c.width = layer.canvas.width;
      c.height = layer.canvas.height;
      const g = c.getContext("2d");
      g.drawImage(layer.canvas, 0, 0);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(layer.mask.canvas, 0, 0);
      return c;
    }

    greenTint(source) {
      const c = document.createElement("canvas");
      c.width = source.width;
      c.height = source.height;
      const g = c.getContext("2d");
      g.fillStyle = "rgba(61,220,151,1)";
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(source, 0, 0);
      return c;
    }

    maskTint() {
      const c = this._tint || (this._tint = document.createElement("canvas"));
      if (c.width !== this.maskCanvas.width || c.height !== this.maskCanvas.height) {
        c.width = this.maskCanvas.width;
        c.height = this.maskCanvas.height;
      }
      const g = c.getContext("2d");
      g.globalCompositeOperation = "source-over";
      g.clearRect(0, 0, c.width, c.height);
      g.fillStyle = "rgba(61,220,151,1)";
      g.fillRect(0, 0, c.width, c.height);
      g.globalCompositeOperation = "destination-in";
      g.drawImage(this.maskCanvas, 0, 0);
      g.globalCompositeOperation = "source-over";
      return c;
    }

    strokeSelection(ctx) {
      ctx.save();
      ctx.strokeStyle = "#4aa8ff";
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1 / this.zoom;
      ctx.beginPath();
      if (this.selection.type === "rect") {
        const s = this.selection;
        ctx.rect(s.x, s.y, s.w, s.h);
      } else {
        const pts = this.selection.points || [];
        if (pts.length) {
          ctx.moveTo(pts[0].x, pts[0].y);
          pts.forEach((p) => ctx.lineTo(p.x, p.y));
          ctx.closePath();
        }
      }
      ctx.stroke();
      ctx.restore();
    }

    placeGen() {
      const g = this.gen;
      this.ga.style.left = (this.panX + g.x * this.zoom) + "px";
      this.ga.style.top = (this.panY + g.y * this.zoom) + "px";
      this.ga.style.width = Math.max(8, g.w * this.zoom) + "px";
      this.ga.style.height = Math.max(8, g.h * this.zoom) + "px";
      const draggingFrame = this.drag && (this.drag.kind === "new-ga" || this.drag.kind === "move-ga" || this.drag.kind === "resize");
      this.ga.hidden = !(state.pipeline === "edit" && (state.area.editScope === "region" || draggingFrame));
      const lab = this.ga.querySelector(".lab");
      const frame = generationSize();
      lab.textContent = frame.w + "×" + frame.h;
      paintStatus();
      lab.classList.toggle("inside", (this.panY + g.y * this.zoom) < 26);
      const run = $("ga-run");
      if (run) {
        run.hidden = !state.running;
        run.style.left = this.ga.style.left;
        run.style.top = this.ga.style.top;
        run.style.width = this.ga.style.width;
        run.style.height = this.ga.style.height;
      }
    }

    flatten() {
      const c = document.createElement("canvas");
      c.width = this.doc.w;
      c.height = this.doc.h;
      const ctx = c.getContext("2d");
      let first = true;
      for (const layer of this.layers) {
        if (!layer.visible) continue;
        ctx.save();
        ctx.globalAlpha = layer.opacity;
        ctx.globalCompositeOperation = first || layer.blend === "normal" ? "source-over" : layer.blend;
        first = false;
        ctx.translate(layer.x, layer.y);
        ctx.rotate(layer.rotation || 0);
        ctx.scale(layer.scaleX || 1, layer.scaleY || 1);
        ctx.drawImage(this.composited(layer), 0, 0);
        ctx.restore();
      }
      return c;
    }

    maskArea() {
      if (!this._maskDirty) return this._maskCount;
      const data = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] > 16) n++;
      this._maskCount = n;
      this._maskDirty = false;
      return n;
    }

    touchMask() {
      this._maskDirty = true;
      this._maskThumb = "";
    }

    maskSelected() {
      if (state.maskFocus === "work") return true;
      return !!(state.maskFocus && state.maskFocus.id);
    }

    paintTarget(tool) {
      if (tool === "mask") return { kind: "work" };
      if (tool !== "brush" && tool !== "eraser") return null;
      if (state.maskFocus === "work") return { kind: "work" };
      if (state.maskFocus && state.maskFocus.id) {
        const layer = this.layers.find((l) => l.id === state.maskFocus.id && l.mask);
        if (layer) return { kind: "layer", layer };
        state.maskFocus = null;
      }
      return null;
    }

    patchCtx(patch) {
      if (!patch) return null;
      if (patch.maskStroke) return this.maskCtx;
      if (patch.layerMaskId) {
        const layer = this.layers.find((l) => l.id === patch.layerMaskId);
        return layer && layer.mask && layer.mask.ctx;
      }
      const layer = this.layers.find((l) => l.id === patch.id);
      return layer && layer.ctx;
    }

    patchLocal(patch, x, y) {
      if (!patch || patch.maskStroke) return { x, y };
      const id = patch.layerMaskId || patch.id;
      const layer = this.layers.find((l) => l.id === id);
      return { x: x - (layer ? layer.x : 0), y: y - (layer ? layer.y : 0) };
    }

    exportMask() {
      const c = document.createElement("canvas");
      c.width = this.doc.w;
      c.height = this.doc.h;
      const g = c.getContext("2d");
      g.fillStyle = "#000";
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(this.maskCanvas, 0, 0);
      return c;
    }

    cropOf(expandFrac) {
      const g = this.gen;
      let x = g.x, y = g.y, w = g.w, h = g.h;
      if (expandFrac > 0) {
        const px = Math.round(w * expandFrac);
        const py = Math.round(h * expandFrac);
        const x2 = Math.min(this.doc.w, g.x + g.w + px);
        const y2 = Math.min(this.doc.h, g.y + g.h + py);
        x = Math.max(0, g.x - px);
        y = Math.max(0, g.y - py);
        w = x2 - x;
        h = y2 - y;
      }
      x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
      w = Math.max(1, Math.min(this.doc.w - x, w));
      h = Math.max(1, Math.min(this.doc.h - y, h));
      const flat = this.flatten();
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      c.getContext("2d").drawImage(flat, x, y, w, h, 0, 0, w, h);
      const mc = document.createElement("canvas");
      mc.width = w; mc.height = h;
      const mg = mc.getContext("2d");
      mg.fillStyle = "#000";
      mg.fillRect(0, 0, w, h);
      if (this.maskArea() > 8) {
        mg.drawImage(this.exportMask(), x, y, w, h, 0, 0, w, h);
      } else if (expandFrac > 0) {
        mg.fillStyle = "#fff";
        mg.fillRect(g.x - x, g.y - y, g.w, g.h);
      } else {
        mg.fillStyle = "#fff";
        mg.fillRect(0, 0, w, h);
      }
      return { canvas: c, mask: mc, x, y, w, h };
    }

    fullSnapshot() {
      return {
        type: "full",
        doc: { ...this.doc },
        gen: { ...this.gen },
        active: this.active,
        mask: this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height),
        maskFocus: state.maskFocus === "work" ? "work" : (state.maskFocus && state.maskFocus.id ? { id: state.maskFocus.id } : null),
        workMaskHidden: !!state.workMaskHidden,
        layers: this.layers.map((l) => ({
          id: l.id, name: l.name, x: l.x, y: l.y, visible: l.visible, opacity: l.opacity,
          blend: l.blend, locked: l.locked, meta: l.meta,
          w: l.canvas.width, h: l.canvas.height,
          data: l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height),
          mask: l.mask ? {
            visible: l.mask.visible !== false,
            w: l.mask.canvas.width,
            h: l.mask.canvas.height,
            data: l.mask.ctx.getImageData(0, 0, l.mask.canvas.width, l.mask.canvas.height),
          } : null,
        })),
      };
    }

    restore(rec) {
      if (!rec) return;
      if (rec.type === "full") {
        this.doc = { ...rec.doc };
        this.gen = { ...rec.gen };
        this.resizeMask();
        this.maskCtx.putImageData(rec.mask, 0, 0);
        this.layers = rec.layers.map((s) => {
          const c = document.createElement("canvas");
          c.width = s.w; c.height = s.h;
          const ctx = c.getContext("2d");
          ctx.putImageData(s.data, 0, 0);
          const layer = this.makeLayer(s.name, c);
          Object.assign(layer, { id: s.id, x: s.x, y: s.y, visible: s.visible, opacity: s.opacity, blend: s.blend, locked: s.locked, meta: s.meta });
          if (s.mask && s.mask.data) {
            const mc = document.createElement("canvas");
            mc.width = s.mask.w; mc.height = s.mask.h;
            const mctx = mc.getContext("2d");
            mctx.putImageData(s.mask.data, 0, 0);
            layer.mask = { canvas: mc, ctx: mctx, visible: s.mask.visible !== false };
            this.maskThumb(layer);
          }
          this.thumb(layer);
          return layer;
        });
        this.active = Math.min(rec.active, this.layers.length - 1);
        state.workMaskHidden = !!rec.workMaskHidden;
        state.maskFocus = rec.maskFocus === "work" ? "work" : (rec.maskFocus && rec.maskFocus.id ? { id: rec.maskFocus.id } : null);
        this.touchMask();
      } else if (rec.type === "patch") {
        const layer = this.layers.find((l) => l.id === (rec.layerMaskId || rec.id));
        const ctx = this.patchCtx(rec);
        if (ctx && rec.data) ctx.putImageData(rec.data, rec.x || 0, rec.y || 0);
        if (rec.maskStroke) this.touchMask();
        else if (rec.layerMaskId) this.maskThumb(layer);
        else this.thumb(layer);
      } else if (rec.type === "pixels") {
        const layer = this.layers.find((l) => l.id === rec.id);
        if (layer && rec.data) layer.ctx.putImageData(rec.data, 0, 0);
        if (rec.mask) this.maskCtx.putImageData(rec.mask, 0, 0);
        this.touchMask();
        this.thumb(layer);
      } else if (rec.type === "gen") {
        this.gen = { ...(rec.gen || this.gen) };
        state.area.editScope = rec.scope === "region" ? "region" : "full";
        state.area.region = rec.region ? { ...rec.region } : state.area.region;
        state.area.userPlaced = state.area.editScope === "region";
        state.area.outputLinked = state.area.editScope !== "region";
      } else if (rec.type === "move") {
        const layer = this.layers.find((l) => l.id === rec.id);
        if (layer) { layer.x = rec.x; layer.y = rec.y; }
      }
      this.requestDraw();
      renderLayers();
      renderInspector();
    }

    pushUndo(rec) {
      this.undoStack.push(rec);
      this.redoStack = [];
      this.trimHistory();
      if (this.onChange) this.onChange();
    }

    trimHistory() {
      const bytes = () => U.historyBytes(this.undoStack);
      while (this.undoStack.length > 20 || (this.undoStack.length > 1 && bytes() > HISTORY_BYTES)) this.undoStack.shift();
    }

    clearHistory() {
      this.undoStack = [];
      this.redoStack = [];
    }

    captureInverse(rec) {
      if (!rec) return null;
      if (rec.type === "full") return this.fullSnapshot();
      if (rec.type === "gen") {
        return { type: "gen", gen: { ...this.gen }, scope: state.area.editScope, region: state.area.region ? { ...state.area.region } : null };
      }
      if (rec.type === "move") {
        const layer = this.layers.find((l) => l.id === rec.id);
        return U.inverseHistory(rec, { x: layer ? layer.x : rec.x, y: layer ? layer.y : rec.y });
      }
      if (rec.type === "patch") {
        const ctx = this.patchCtx(rec);
        const data = ctx && rec.w ? ctx.getImageData(rec.x, rec.y, rec.w, rec.h) : rec.data;
        return { type: "patch", id: rec.id, maskStroke: !!rec.maskStroke, layerMaskId: rec.layerMaskId || "", x: rec.x, y: rec.y, w: rec.w, h: rec.h, data };
      }
      if (rec.type === "pixels") {
        const layer = this.layers.find((l) => l.id === rec.id);
        const data = layer && rec.data ? layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height) : rec.data;
        const mask = rec.mask ? this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height) : null;
        return U.inverseHistory(rec, { data, mask });
      }
      return null;
    }

    undo() {
      const rec = this.undoStack.pop();
      if (!rec) return;
      const inverse = this.captureInverse(rec);
      if (inverse) this.redoStack.push(inverse);
      this.restore(rec);
    }

    redo() {
      const rec = this.redoStack.pop();
      if (!rec) return;
      const inverse = this.captureInverse(rec);
      if (inverse) this.undoStack.push(inverse);
      this.restore(rec);
    }

    thumb(layer) {
      if (!layer) return;
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const g = c.getContext("2d");
      const s = Math.max(layer.canvas.width, layer.canvas.height);
      const dw = 32 * layer.canvas.width / s;
      const dh = 32 * layer.canvas.height / s;
      g.drawImage(layer.canvas, (32 - dw) / 2, (32 - dh) / 2, dw, dh);
      layer.thumb = c.toDataURL("image/png");
    }

    maskThumb(layer) {
      if (!layer) return;
      if (!layer.mask) { layer.maskThumb = ""; return; }
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const g = c.getContext("2d");
      g.fillStyle = "#000";
      g.fillRect(0, 0, 32, 32);
      const s = Math.max(layer.mask.canvas.width, layer.mask.canvas.height) || 1;
      const dw = 32 * layer.mask.canvas.width / s;
      const dh = 32 * layer.mask.canvas.height / s;
      g.drawImage(layer.mask.canvas, (32 - dw) / 2, (32 - dh) / 2, dw, dh);
      layer.maskThumb = c.toDataURL("image/png");
    }

    workMaskPreview() {
      if (this._maskThumb) return this._maskThumb;
      if (this.maskArea() <= 0) return "";
      const c = document.createElement("canvas");
      c.width = 32; c.height = 32;
      const g = c.getContext("2d");
      g.fillStyle = "#10241c";
      g.fillRect(0, 0, 32, 32);
      const s = Math.max(this.maskCanvas.width, this.maskCanvas.height) || 1;
      const dw = 32 * this.maskCanvas.width / s;
      const dh = 32 * this.maskCanvas.height / s;
      g.drawImage(this.maskCanvas, (32 - dw) / 2, (32 - dh) / 2, dw, dh);
      this._maskThumb = c.toDataURL("image/png");
      return this._maskThumb;
    }

    clearWorkMask() {
      this.pushUndo(this.fullSnapshot());
      this.consumeWorkMask();
      this.requestDraw();
      renderLayers();
      renderInspector();
    }

    consumeWorkMask() {
      this.maskCtx.clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
      this.touchMask();
      state.workMaskHidden = false;
      if (state.maskFocus === "work" && state.tool !== "mask") state.maskFocus = null;
    }

    invertWorkMask() {
      this.pushUndo(this.fullSnapshot());
      const w = this.maskCanvas.width;
      const h = this.maskCanvas.height;
      const img = this.maskCtx.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const inv = 255 - d[i + 3];
        d[i] = d[i + 1] = d[i + 2] = inv ? 255 : 0;
        d[i + 3] = inv;
      }
      this.maskCtx.putImageData(img, 0, 0);
      this.touchMask();
      state.maskFocus = "work";
      this.requestDraw();
      renderLayers();
    }

    toggleWorkMask() {
      this.pushUndo(this.fullSnapshot());
      state.workMaskHidden = !state.workMaskHidden;
      this.requestDraw();
      renderLayers();
    }

    focusWorkMask() {
      state.maskFocus = "work";
      if (state.tool !== "brush" && state.tool !== "eraser" && state.tool !== "mask") setTool("mask");
      else { this.requestDraw(); renderLayers(); }
    }

    copyMask(from, to) {
      if (!from || !from.mask || !to) return;
      const c = document.createElement("canvas");
      c.width = from.mask.canvas.width;
      c.height = from.mask.canvas.height;
      c.getContext("2d").drawImage(from.mask.canvas, 0, 0);
      to.mask = { canvas: c, ctx: c.getContext("2d"), visible: from.mask.visible !== false };
      this.maskThumb(to);
    }

    attachLayerMask(layer, maskSource, featherPx) {
      if (!layer || !maskSource) return;
      const w = layer.canvas.width;
      const h = layer.canvas.height;
      const blurred = document.createElement("canvas");
      blurred.width = w;
      blurred.height = h;
      const bg = blurred.getContext("2d");
      const px = Math.max(0, Number(featherPx) || 0);
      if (px > 0) bg.filter = `blur(${px}px)`;
      bg.drawImage(maskSource, 0, 0, w, h);
      bg.filter = "none";
      const img = bg.getImageData(0, 0, w, h);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const lum = Math.max(d[i], d[i + 1], d[i + 2]);
        d[i] = d[i + 1] = d[i + 2] = 255;
        d[i + 3] = lum;
      }
      bg.putImageData(img, 0, 0);
      layer.mask = { canvas: blurred, ctx: bg, visible: true };
      this.maskThumb(layer);
    }

    deleteLayerMask(layer) {
      layer = layer || this.activeLayer();
      if (!layer || !layer.mask) return;
      this.pushUndo(this.fullSnapshot());
      if (state.maskFocus && state.maskFocus.id === layer.id) state.maskFocus = null;
      layer.mask = null;
      layer.maskThumb = "";
      this.thumb(layer);
      this.requestDraw();
      renderLayers();
    }

    applyLayerMask(layer) {
      layer = layer || this.activeLayer();
      if (!layer || !layer.mask) return;
      this.pushUndo(this.fullSnapshot());
      const baked = this.composited(layer);
      const g = baked.getContext("2d");
      g.globalCompositeOperation = "source-over";
      layer.canvas = baked;
      layer.ctx = g;
      layer.mask = null;
      layer.maskThumb = "";
      if (state.maskFocus && state.maskFocus.id === layer.id) state.maskFocus = null;
      this.thumb(layer);
      this.requestDraw();
      renderLayers();
    }

    bind() {
      const down = (e) => this.pointerDown(e);
      this.canvas.addEventListener("pointerdown", down);
      this.ga.addEventListener("pointerdown", (e) => {
        const handleEl = e.target.closest && e.target.closest("[data-h]");
        if (!handleEl || !this.ga.contains(handleEl) || e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        this.beginFrameDrag(handleEl.dataset.h, e.clientX, e.clientY, handleEl, e.pointerId);
      });
      window.addEventListener("pointermove", (e) => this.pointerMove(e));
      window.addEventListener("pointerup", (e) => this.pointerUp(e));
      this.stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
        this.zoomBy(factor, e.clientX, e.clientY);
      }, { passive: false });
      window.addEventListener("keydown", (e) => {
        if (document.querySelector(".modal-back")) return;
        if (e.code === "Space") { this.space = true; if (!/^(input|textarea|select)$/i.test((e.target.tagName || ""))) e.preventDefault(); }
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const key = e.key.toLowerCase();
          if (key === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
          if (key === "y") { e.preventDefault(); this.redo(); return; }
          if (e.key === "0") { e.preventDefault(); this.fit(); return; }
          if (e.key === "1") { e.preventDefault(); this.zoom100(); return; }
          if (key === "s") { e.preventDefault(); saveProject().then(() => toast("Проект сохранён.")).catch((err) => toast(err.message || String(err))); return; }
          if (key === "n") { e.preventDefault(); newProject(); return; }
          if (U.maskShortcutClears(e.key, true, state.maskFocus) === "clear") {
            const typing = /^(input|textarea|select)$/i.test(e.target.tagName || "");
            if (typing) return;
            e.preventDefault();
            this.clearWorkMask();
            return;
          }
        }
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        const map = { KeyV: "move", KeyM: "select", KeyL: "lasso", KeyT: "transform", KeyC: "crop", KeyB: "brush", KeyE: "eraser", KeyI: "eyedrop", KeyQ: "mask", KeyG: "genarea", KeyH: "hand", KeyZ: "zoom" };
        if (e.key === "?" || (e.shiftKey && e.code === "Slash")) { e.preventDefault(); toggleHelp(true); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "Delete" || e.key === "Backspace") {
          if (U.maskShortcutClears(e.key, false, state.maskFocus) === "clear") { e.preventDefault(); this.clearWorkMask(); return; }
          if (state.maskFocus && state.maskFocus.id) {
            const masked = this.layers.find((l) => l.id === state.maskFocus.id && l.mask);
            if (masked) { e.preventDefault(); this.deleteLayerMask(masked); return; }
          }
          this.deleteActive();
          return;
        }
        if (e.key === "[") { state.brush.size = Math.max(1, state.brush.size - 4); const b = $("brush-size"); if (b) b.value = state.brush.size; renderToolOptions(); }
        if (e.key === "]") { state.brush.size = Math.min(300, state.brush.size + 4); const b = $("brush-size"); if (b) b.value = state.brush.size; renderToolOptions(); }
        if (map[e.code]) { setTool(map[e.code]); }
      });
      window.addEventListener("keyup", (e) => { if (e.code === "Space") this.space = false; });
      window.addEventListener("blur", () => { this.space = false; });
    }

    frameHit(clientX, clientY) {
      if (!this.ga || this.ga.hidden) return "";
      const el = document.elementFromPoint(clientX, clientY);
      const handle = el && el.closest ? el.closest("[data-h]") : null;
      if (!handle || !this.ga.contains(handle)) return "";
      return handle.dataset.h || "";
    }

    beginFrameDrag(handle, clientX, clientY, captureEl) {
      if (state.pipeline === "edit" && state.area.editScope !== "region") applyEditScope("region");
      const p = this.screenToDoc(clientX, clientY);
      this.drag = {
        kind: handle === "move" ? "move-ga" : "resize",
        handle: handle || "se",
        x: p.x, y: p.y,
        gen: { ...this.gen },
        gen0: { ...this.gen },
        scope0: state.area.editScope,
        region0: state.area.region ? { ...state.area.region } : null,
      };
      if (captureEl && captureEl.setPointerCapture && pointerId != null) {
        try { captureEl.setPointerCapture(pointerId); } catch { /* already released */ }
      }
    }

    pointerDown(e) {
      if (e.button === 1 || this.space || state.tool === "hand") {
        this.drag = { kind: "pan", x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
        return;
      }
      const hit = this.frameHit(e.clientX, e.clientY);
      if (hit) { this.beginFrameDrag(hit, e.clientX, e.clientY, e.target, e.pointerId); return; }
      const p = this.screenToDoc(e.clientX, e.clientY);
      const tool = state.tool;
      if (tool === "zoom") {
        this.zoom = Math.min(8, this.zoom * (e.altKey ? 0.8 : 1.25));
        this.requestDraw();
        return;
      }
      if (tool === "eyedrop") {
        const flat = this.flatten();
        const x = Math.max(0, Math.min(flat.width - 1, Math.floor(p.x)));
        const y = Math.max(0, Math.min(flat.height - 1, Math.floor(p.y)));
        const px = flat.getContext("2d").getImageData(x, y, 1, 1).data;
        state.color = "#" + [px[0], px[1], px[2]].map((n) => n.toString(16).padStart(2, "0")).join("");
        $("swatch").value = state.color;
        return;
      }
      if (tool === "genarea") {
        if (state.pipeline === "edit" && state.area.editScope !== "region") applyEditScope("region");
        this.drag = { kind: "new-ga", x: p.x, y: p.y, gen: { ...this.gen }, gen0: { ...this.gen }, scope0: state.area.editScope, region0: state.area.region ? { ...state.area.region } : null };
        return;
      }
      if (tool === "select" || tool === "crop" || tool === "lasso") {
        this.drag = { kind: tool, x: p.x, y: p.y, points: [{ ...p }] };
        return;
      }
      if (tool === "move") {
        const layer = this.activeLayer();
        if (!layer || layer.locked) return;
        this.pushUndo({ type: "move", id: layer.id, x: layer.x, y: layer.y });
        this.undoStack.pop(); // push happens on up; store start
        this.drag = { kind: "move", id: layer.id, x: p.x, y: p.y, lx: layer.x, ly: layer.y };
        return;
      }
      if (tool === "transform") {
        this.drag = { kind: "transform", id: this.activeLayer() && this.activeLayer().id, x: p.x, y: p.y, snapshot: this.fullSnapshot() };
        return;
      }
      if (tool === "brush" || tool === "eraser" || tool === "mask") {
        const layer = this.activeLayer();
        const onMask = U.brushTargetsMask(tool, this.maskSelected());
        const target = onMask ? this.paintTarget(tool) : null;
        if (target && target.kind === "layer" && target.layer.locked) { toast("Слой заблокирован."); return; }
        if (!target && (!layer || layer.locked)) { toast(layer && layer.locked ? "Слой заблокирован." : "Нет слоя."); return; }
        if (tool === "mask") state.maskFocus = "work";
        const patch = {
          type: "patch",
          id: target && target.kind === "layer" ? target.layer.id : (layer && layer.id),
          maskStroke: !!(target && target.kind === "work"),
          layerMaskId: target && target.kind === "layer" ? target.layer.id : "",
          x: 0, y: 0, w: 0, h: 0, data: null,
        };
        this.drag = { kind: "paint", x: p.x, y: p.y, patch };
        if (patch.maskStroke) this._maskLive = true;
        this.notePatch(patch, p.x, p.y);
        this.stamp(p.x, p.y);
      }
    }

    pointerMove(e) {
      if (!this.drag) {
        const hit = this.frameHit(e.clientX, e.clientY);
        if (hit && state.tool !== "hand") {
          const cursors = { n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize", move: "move" };
          this.canvas.style.cursor = cursors[hit] || "move";
        }
        return;
      }
      const p = this.screenToDoc(e.clientX, e.clientY);
      const d = this.drag;
      if (d.kind === "pan") {
        this.panX = d.panX + (e.clientX - d.x);
        this.panY = d.panY + (e.clientY - d.y);
      } else if (d.kind === "move-ga" || d.kind === "resize" || d.kind === "new-ga") {
        this.dragGen(d, p);
      } else if (d.kind === "move") {
        const layer = this.layers.find((l) => l.id === d.id);
        if (layer) { layer.x = Math.round(d.lx + (p.x - d.x)); layer.y = Math.round(d.ly + (p.y - d.y)); }
      } else if (d.kind === "paint") {
        this.noteSegment(d.patch, d.x, d.y, p.x, p.y);
        this.strokeLine(d.x, d.y, p.x, p.y);
        d.x = p.x; d.y = p.y;
      } else if (d.kind === "select" || d.kind === "crop") {
        this.selection = { type: "rect", x: Math.min(d.x, p.x), y: Math.min(d.y, p.y), w: Math.abs(p.x - d.x), h: Math.abs(p.y - d.y), crop: d.kind === "crop" };
      } else if (d.kind === "lasso") {
        d.points.push(p);
        this.selection = { type: "lasso", points: d.points };
      } else if (d.kind === "transform") {
        const layer = this.activeLayer();
        if (layer && !layer.locked) {
          const s = 1 + (p.x - d.x) / 200;
          layer.scaleX = layer.scaleY = Math.max(0.05, s);
        }
      }
      this.requestDraw();
    }

    pointerUp() {
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.kind === "paint" && d.patch && d.patch.data) {
        this._maskLive = false;
        this.touchMask();
        this.pushUndo(d.patch);
        const painted = d.patch.layerMaskId ? this.layers.find((l) => l.id === d.patch.layerMaskId) : this.activeLayer();
        this.thumb(painted);
        if (d.patch.layerMaskId) this.maskThumb(painted);
        renderLayers();
        renderTags();
      }
      if (d.kind === "move") this.pushUndo({ type: "move", id: d.id, x: d.lx, y: d.ly });
      if (d.kind === "move-ga" || d.kind === "resize" || d.kind === "new-ga") {
        this.gen = window.ZeroImageStudioSize.snapRect(this.gen, modelStep(), this.doc);
        state.area.editScope = "region";
        state.area.userPlaced = true;
        state.area.outputLinked = false;
        state.area.region = { x: this.gen.x, y: this.gen.y, w: this.gen.w, h: this.gen.h };
        const before = d.gen0 || d.gen;
        if (before && (before.x !== this.gen.x || before.y !== this.gen.y || before.w !== this.gen.w || before.h !== this.gen.h)) {
          this.pushUndo({ type: "gen", gen: { ...before }, scope: d.scope0 || "full", region: d.region0 || null });
        }
      }
      if (d.kind === "crop" && this.selection && this.selection.w > 4 && this.selection.h > 4) this.applyCrop(this.selection);
      if (d.kind === "transform" && d.snapshot) { this.bakeActive(); this.pushUndo(d.snapshot); }
      renderInspector();
      renderLayers();
      renderPipe();
      paintStatus();
    }

    dragGen(d, p) {
      state.area.userPlaced = true;
      const aspect = state.area.aspect;
      const ratio = aspect === "free" ? 0 : aspect.split(":").map(Number).reduce((a, b) => a / b);
      if (d.kind === "new-ga") {
        let w = p.x - d.x, h = p.y - d.y;
        if (ratio) h = Math.sign(h || 1) * Math.abs(w) / ratio;
        this.gen = normalizeRect(d.x, d.y, w, h, this.doc.w, this.doc.h);
      } else if (d.kind === "move-ga") {
        this.gen.x = clamp(Math.round(d.gen.x + (p.x - d.x)), 0, this.doc.w - d.gen.w);
        this.gen.y = clamp(Math.round(d.gen.y + (p.y - d.y)), 0, this.doc.h - d.gen.h);
      } else if (d.kind === "resize") {
        let x = d.gen.x, y = d.gen.y, x2 = d.gen.x + d.gen.w, y2 = d.gen.y + d.gen.h;
        if (d.handle.includes("w")) x = p.x;
        if (d.handle.includes("e")) x2 = p.x;
        if (d.handle.includes("n")) y = p.y;
        if (d.handle.includes("s")) y2 = p.y;
        let w = x2 - x, h = y2 - y;
        if (ratio && Math.abs(w) > 2) h = Math.sign(h || 1) * Math.abs(w) / ratio;
        this.gen = normalizeRect(x, y, w, h, this.doc.w, this.doc.h);
      }
      this.gen = window.ZeroImageStudioSize.snapRect(this.gen, modelStep(), this.doc);
      state.area.editScope = "region";
      state.area.userPlaced = true;
      state.area.outputLinked = false;
      state.area.region = { x: this.gen.x, y: this.gen.y, w: this.gen.w, h: this.gen.h };
      renderInspector();
    }

    strokeLine(x0, y0, x1, y1) {
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const step = Math.max(1, state.brush.size * 0.25);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= n; i++) this.stamp(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    }

    noteSegment(patch, x0, y0, x1, y1) {
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const step = Math.max(1, state.brush.size * 0.5);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= n; i++) this.notePatch(patch, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    }

    notePatch(patch, x, y) {
      if (!patch) return;
      const ctx = this.patchCtx(patch);
      if (!ctx) return;
      const rad = Math.max(1, state.brush.size / 2 + 2);
      const local = this.patchLocal(patch, x, y);
      const lx = local.x;
      const ly = local.y;
      const canvas = ctx.canvas;
      const x0 = Math.max(0, Math.floor(lx - rad));
      const y0 = Math.max(0, Math.floor(ly - rad));
      const x1 = Math.min(canvas.width, Math.ceil(lx + rad));
      const y1 = Math.min(canvas.height, Math.ceil(ly + rad));
      if (x1 <= x0 || y1 <= y0) return;
      if (!patch.data) {
        patch.x = x0; patch.y = y0; patch.w = x1 - x0; patch.h = y1 - y0;
        patch.data = ctx.getImageData(patch.x, patch.y, patch.w, patch.h);
        return;
      }
      const nx = Math.min(patch.x, x0);
      const ny = Math.min(patch.y, y0);
      const nx2 = Math.max(patch.x + patch.w, x1);
      const ny2 = Math.max(patch.y + patch.h, y1);
      if (nx === patch.x && ny === patch.y && nx2 === patch.x + patch.w && ny2 === patch.y + patch.h) return;
      const nw = nx2 - nx;
      const nh = ny2 - ny;
      const next = ctx.createImageData(nw, nh);
      next.data.set(ctx.getImageData(nx, ny, nw, nh).data);
      const ox = patch.x - nx;
      const oy = patch.y - ny;
      const src = patch.data.data;
      const dst = next.data;
      for (let row = 0; row < patch.h; row++) {
        dst.set(src.subarray(row * patch.w * 4, (row + 1) * patch.w * 4), ((oy + row) * nw + ox) * 4);
      }
      patch.x = nx; patch.y = ny; patch.w = nw; patch.h = nh; patch.data = next;
    }

    stamp(x, y) {
      const size = state.brush.size;
      const hard = state.brush.hardness;
      const patch = this.drag && this.drag.patch;
      if (patch && (patch.maskStroke || patch.layerMaskId)) {
        const ctx = this.patchCtx(patch);
        if (!ctx) return;
        const local = this.patchLocal(patch, x, y);
        ctx.save();
        if (state.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
        const grd = ctx.createRadialGradient(local.x, local.y, size * hard * 0.5, local.x, local.y, size / 2);
        grd.addColorStop(0, `rgba(255,255,255,${state.brush.opacity})`);
        grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(local.x, local.y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      const layer = this.activeLayer();
      if (!layer || layer.locked) return;
      const ctx = layer.ctx;
      ctx.save();
      if (this.selection) this.clipSel(ctx, layer);
      if (state.tool === "eraser") ctx.globalCompositeOperation = "destination-out";
      const lx = x - layer.x, ly = y - layer.y;
      const grd = ctx.createRadialGradient(lx, ly, size * hard * 0.5, lx, ly, size / 2);
      const col = state.color;
      grd.addColorStop(0, hexA(col, state.brush.opacity));
      grd.addColorStop(1, hexA(col, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(lx, ly, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    clipSel(ctx, layer) {
      ctx.beginPath();
      const s = this.selection;
      if (s.type === "rect") ctx.rect(s.x - layer.x, s.y - layer.y, s.w, s.h);
      else {
        const pts = s.points || [];
        if (!pts.length) return;
        ctx.moveTo(pts[0].x - layer.x, pts[0].y - layer.y);
        pts.forEach((p) => ctx.lineTo(p.x - layer.x, p.y - layer.y));
        ctx.closePath();
      }
      ctx.clip();
    }

    applyCrop(sel) {
      const snap = this.fullSnapshot();
      const x = Math.max(0, Math.round(sel.x));
      const y = Math.max(0, Math.round(sel.y));
      const w = Math.max(1, Math.min(this.doc.w - x, Math.round(sel.w)));
      const h = Math.max(1, Math.min(this.doc.h - y, Math.round(sel.h)));
      for (const layer of this.layers) {
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(layer.canvas, layer.x - x, layer.y - y);
        layer.canvas = c;
        layer.ctx = c.getContext("2d");
        if (layer.mask) {
          const mc = document.createElement("canvas");
          mc.width = w; mc.height = h;
          mc.getContext("2d").drawImage(layer.mask.canvas, layer.x - x, layer.y - y);
          layer.mask.canvas = mc;
          layer.mask.ctx = mc.getContext("2d");
          this.maskThumb(layer);
        }
        layer.x = 0; layer.y = 0;
        this.thumb(layer);
      }
      const mc = document.createElement("canvas");
      mc.width = w; mc.height = h;
      mc.getContext("2d").drawImage(this.maskCanvas, -x, -y);
      this.doc = { w, h };
      this.maskCanvas = mc;
      this.maskCtx = mc.getContext("2d");
      this.gen = { x: Math.round(w * 0.18), y: Math.round(h * 0.08), w: Math.round(w * 0.64), h: Math.round(h * 0.5) };
      this.selection = null;
      this.pushUndo(snap);
      this.fit();
      renderLayers();
      toast("Холст обрезан.");
    }

    bakeActive() {
      const layer = this.activeLayer();
      if (!layer) return;
      if ((layer.scaleX || 1) === 1 && (layer.scaleY || 1) === 1 && !(layer.rotation)) return;
      const w = Math.max(1, Math.round(layer.canvas.width * layer.scaleX));
      const h = Math.max(1, Math.round(layer.canvas.height * layer.scaleY));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const g = c.getContext("2d");
      g.drawImage(layer.canvas, 0, 0, w, h);
      layer.canvas = c;
      layer.ctx = g;
      layer.scaleX = 1;
      layer.scaleY = 1;
      layer.rotation = 0;
      this.thumb(layer);
    }

    deleteActive() {
      const layer = this.activeLayer();
      if (!layer || layer.locked) { toast(layer && layer.locked ? "Слой заблокирован." : "Нет слоя."); return; }
      this.pushUndo(this.fullSnapshot());
      if (state.maskFocus && state.maskFocus.id === layer.id) state.maskFocus = null;
      this.layers.splice(this.active, 1);
      this.active = Math.max(0, this.active - 1);
      this.requestDraw();
      renderLayers();
    }

    exportMeta() {
      return {
        version: 1,
        name: state.projectName,
        canvas: { ...this.doc },
        gen: { ...this.gen },
        mask: "mask.png",
        layers: this.layers.map((l) => ({
          id: l.id, name: l.name, file: "layers/" + l.id + ".png",
          mask: l.mask ? "layers/" + l.id + ".mask.png" : "",
          x: l.x, y: l.y, visible: l.visible, opacity: l.opacity, blend: l.blend,
          locked: l.locked, meta: l.meta,
        })),
        references: state.references.map((r) => ({ id: r.id, name: r.name, file: "refs/" + r.id + ".png" })),
      };
    }
  }

  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function normalizeRect(x, y, w, h, maxW, maxH) {
    if (w < 0) { x += w; w = -w; }
    if (h < 0) { y += h; h = -h; }
    w = Math.max(16, w); h = Math.max(16, h);
    x = clamp(Math.round(x), 0, Math.max(0, maxW - 16));
    y = clamp(Math.round(y), 0, Math.max(0, maxH - 16));
    w = Math.min(Math.round(w), maxW - x);
    h = Math.min(Math.round(h), maxH - y);
    return { x, y, w, h };
  }
  function hexA(hex, a) {
    const n = hex.replace("#", "");
    const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  let editor;

  function setTool(name) {
    state.tool = name;
    document.querySelectorAll(".tool").forEach((b) => b.classList.toggle("on", b.dataset.tool === name));
    renderToolOptions();
    const meta = $("insp-meta");
    if (meta && editor) meta.textContent = inspectorContext();
    const cursors = { brush: "crosshair", eraser: "crosshair", mask: "crosshair", hand: "grab", zoom: "zoom-in", move: "move", genarea: "crosshair", crop: "crosshair", select: "crosshair", lasso: "crosshair", eyedrop: "crosshair", transform: "move" };
    editor.canvas.style.cursor = cursors[name] || "default";
    if (name === "mask") state.maskFocus = "work";
    editor.requestDraw();
    renderLayers();
  }

  function renderAll() {
    renderHints();
    renderFiles();
    renderRefs();
    renderLoras();
    renderSampler();
    renderInspector();
    renderLayers();
    renderChips();
    renderPipe();
    renderPresetSelect();
    renderTags();
    renderToolOptions();
    renderKreaChrome();
    updateGenerateButton();
    renderModelSummary();
    $("prompt").value = state.prompt;
    $("negative").value = state.negative;
    fitPromptField();
    $("project-name").value = state.projectName;
    document.querySelectorAll("#mode button").forEach((b) => b.classList.toggle("on", b.dataset.pipe === state.pipeline));
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(document);
  }

  function canonicalHintId(id) {
    if (id === "qwen_image_21_edit") return "qwen_image_21";
    return id || "";
  }

  function hintPipelines(h) {
    if (h && Array.isArray(h.pipelines) && h.pipelines.length) return h.pipelines;
    return [((h && h.pipeline) || "create")];
  }

  function hintsForMode(mode) {
    return state.hints.filter((h) => hintPipelines(h).includes(mode));
  }

  function hintTags(h, mode) {
    const tags = (h && h.tags) || [];
    if (!Array.isArray(tags)) return tags[mode] || tags.create || tags.edit || [];
    return tags;
  }

  function renderHints() {
    const host = $("hint-list");
    const list = hintsForMode(state.pipeline);
    host.innerHTML = list.map((h) => {
      const on = h.id === state.hintId;
      const tags = hintTags(h, state.pipeline).map((t, i) => `<span class="tag ${on && i === 0 ? "to" : ""}">${escapeHtml(t)}</span>`).join("");
      return `<button type="button" class="mrow ${on ? "on" : ""}" data-hint="${escapeHtml(h.id)}" title="${escapeHtml(h.name)}"><span class="rd"></span><b>${escapeHtml(h.name)}</b><span class="tg">${tags}</span></button>`;
    }).join("") || '<div class="empty">Нет моделей для этого режима.</div>';
  }

  function renderModelSummary() {
    const el = $("model-summary");
    if (!el) return;
    const hint = state.hints.find((h) => h.id === state.hintId);
    const c = cfg();
    if (!hint) {
      el.textContent = "Модель не выбрана";
      el.title = el.textContent;
      return;
    }
    const third = c.loader === "checkpoint"
      ? ((c.checkpoint || "чекпоинт").replace(/\.[^.]+$/, ""))
      : (c.clip_type || "");
    const text = [hint.name, c.loader || "diffusion", third].filter(Boolean).join(" · ");
    el.textContent = text;
    el.title = text;
  }

  function fileOptions(list, current, suggested) {
    const opts = ['<option value="">— выбрать —</option>'].concat((list || []).map((n) => `<option ${n === current ? "selected" : ""}>${escapeHtml(n)}</option>`));
    const missing = suggested && current === suggested && !(list || []).includes(suggested);
    return opts.join("") + (missing ? "" : "");
  }

  function renderFiles() {
    const c = cfg();
    const cat = state.catalog || { checkpoints: [], unets: [], clips: [], vaes: [], clip_types: [], weight_dtypes: [] };
    const hint = state.hints.find((h) => h.id === state.hintId);
    const sug = (hint && hint.defaults) || {};
    const sel = (id, list, value) => `<select class="dd" data-file="${id}" style="width:100%">${fileOptions(list, value)}</select>`;
    $("file-block").innerHTML = `
      <label>Загрузчик ${sel("loader", ["diffusion", "checkpoint"], c.loader)}</label>
      <label style="${c.loader === "checkpoint" ? "" : "display:none"}">Checkpoint ${sel("checkpoint", cat.checkpoints, c.checkpoint)}</label>
      <label style="${c.loader === "diffusion" ? "" : "display:none"}">UNET ${sel("unet", cat.unets, c.unet)}</label>
      <label style="${c.loader === "diffusion" ? "" : "display:none"}">CLIP ${sel("clip", cat.clips, c.clip)}</label>
      <label style="${c.loader === "diffusion" ? "" : "display:none"}">Тип CLIP ${sel("clip_type", cat.clip_types, c.clip_type)}</label>
      <label style="${c.loader === "diffusion" ? "" : "display:none"}">VAE ${sel("vae", cat.vaes, c.vae)}</label>
      <label>dtype ${sel("weight_dtype", cat.weight_dtypes, c.weight_dtype)}</label>
      ${sug.unet ? `<div class="mu">Можно любой совместимый файл. Часто ставят ${escapeHtml([sug.unet, sug.clip, sug.vae].filter(Boolean).join(" · "))}.</div>` : ""}
    `;
    const methodRow = state.pipeline === "edit"
      ? `<label>Способ <select class="dd" data-file="method" style="width:100%">${["inpaint", "krea2_edit", "qwen_image_21", "qwen_image"].map((m) => `<option ${c.method === m ? "selected" : ""} value="${m}">${methodLabel(m)}</option>`).join("")}</select></label>`
      : `<label>Энкодер <select class="dd" data-file="encoder" style="width:100%">${[["clip", "CLIPTextEncode"], ["qwen_image_21", "TextEncodeQwenImage21"]].map(([v, n]) => `<option ${c.encoder === v ? "selected" : ""} value="${v}">${n}</option>`).join("")}</select></label>`;
    const krea = c.krea || {};
    const kreaRow = state.pipeline === "edit" && c.method === "krea2_edit" ? `
      <label>Fit <select class="dd" data-krea="fit_mode" style="width:100%"><option ${krea.fit_mode === "fit" ? "selected" : ""}>fit</option><option ${krea.fit_mode === "crop (legacy)" ? "selected" : ""}>crop (legacy)</option></select></label>
      <label>Позиция референса <select class="dd" data-krea="ref_position" style="width:100%" disabled title="Позицию задаёт режим Правка или Персонаж">${["aligned (trained)", "beside (right of target)", "bag of features"].map((v) => `<option ${krea.ref_position === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Grounding, px <input class="f" data-krea="grounding_px" value="${U.finiteNumber(krea.grounding_px, 768)}" title="Ниже — сильнее инструкция, выше — сильнее сходство"></label>
      <label>Ноды <select class="dd" data-krea="impl" style="width:100%"><option value="internal" ${krea.impl !== "external" ? "selected" : ""}>встроенные</option><option value="external" ${krea.impl === "external" ? "selected" : ""}>пакет comfyui-krea2edit</option></select></label>` : "";
    const qwenUsesEncoder = (state.pipeline === "edit" && (c.method === "qwen_image_21" || c.method === "qwen")) || (c.encoder === "qwen_image_21" && usesSource());
    const qwenRow = qwenUsesEncoder
      ? `<label>Qwen resolution <input class="f" data-file="qwen_resolution" value="${U.finiteNumber(c.qwen_resolution, 0)}"></label>` : "";
    $("graph-options").innerHTML = `
      ${methodRow}
      <label>Латент <select class="dd" data-file="latent_mode" style="width:100%"><option value="standard" ${c.latent_mode !== "sd3" ? "selected" : ""}>EmptyLatentImage (4 кан.)</option><option value="sd3" ${c.latent_mode === "sd3" ? "selected" : ""}>EmptySD3LatentImage (16 кан.)</option></select></label>
      <label>Inpaint <select class="dd" data-file="inpaint_mode" style="width:100%"><option value="vae_encode" ${c.inpaint_mode !== "inpaint_conditioning" ? "selected" : ""}>VAEEncodeForInpaint</option><option value="inpaint_conditioning" ${c.inpaint_mode === "inpaint_conditioning" ? "selected" : ""}>InpaintModelConditioning</option></select></label>
      ${kreaRow}${qwenRow}
    `;
  }

  function methodLabel(m) {
    return { inpaint: "Inpaint / img2img (любая модель)", krea2_edit: "Krea 2 Edit", qwen_image_21: "Qwen Image 2.1", qwen_image: "Qwen Image Edit (прежний)" }[m] || m;
  }

  function renderRefs() {
    const host = $("ref-list");
    const cards = state.references.map((r) =>
      `<div class="ref ${r.selected ? "on" : ""}" data-ref="${escapeHtml(r.id)}" title="Клик — выбрать для LLM"><img src="${r.url}"><s>${escapeHtml(r.name)}</s><button class="x" data-ref-del="${escapeHtml(r.id)}">×</button></div>`
    ).join("");
    host.innerHTML = cards +
      `<button class="ref add" id="ref-upload" type="button"><div><span data-i="upload" data-s="15"></span><br>Загрузить</div></button>` +
      `<button class="ref add" id="ref-from-layer" type="button"><div><span data-i="layers" data-s="15"></span><br>Из слоя</div></button>`;
    const n = state.references.length;
    if (state.pipeline === "edit") {
      const method = cfg().method;
      $("ref-cap").textContent = `для модели · ${n}`;
      $("ref-hint").textContent = method === "krea2_edit"
        ? kreaRefHint()
        : (method === "qwen_image_21" || method === "qwen")
          ? "Для модели: до 16 референсов, в промте <image1>…. Те же кадры может взять LLM. Клик по карточке выбирает кадр для LLM."
          : "Кроп холста идёт в модель как область правки. Референсы здесь — для LLM. Клик по карточке выбирает кадр.";
    } else {
      $("ref-cap").textContent = `для LLM-промта · ${n}`;
      $("ref-hint").textContent = "В режиме Создание референсы не идут в модель. «Описать изображение» и «Улучшить» берут выбранные кадры (если ничего не выбрано — все).";
    }
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
    sealCollapsed($("refs-node"));
  }

  function activeLoras() { return cfg().loras; }

  function renderLoras() {
    syncKreaStack();
    const added = activeLoras();
    $("lora-count").textContent = String(added.length);
    if (document.body.dataset.tab === "lora") renderLoraLibrary();
    else renderLoraStack();
  }

  function taskRowHtml(l) {
    const badge = kreaTaskId() === "identity" ? "Персонаж" : "Правка";
    const base = U.fileBase(l.name);
    return `<div class="lora-row ${l.enabled ? "" : "off"}">
      <button type="button" class="cb ${l.enabled ? "on" : ""}" data-lora-enable="${escapeHtml(l.name)}" title="Включить или выключить"></button>
      <span class="task-badge" title="LoRA подрежима">${badge}</span>
      <button type="button" class="nm" data-lora-swap="1" title="Выбрать другой файл">${escapeHtml(base)}</button>
      <input class="range" data-str="model" data-lora-name="${escapeHtml(l.name)}" type="range" min="0" max="2" step="0.05" value="${Number(l.strength_model)}" title="Сила">
      <input class="f" data-str-num="model" data-lora-name="${escapeHtml(l.name)}" value="${Number(l.strength_model).toFixed(2)}" title="Сила">
    </div>`;
  }

  function renderLoraStack() {
    const list = activeLoras();
    const enabled = list.filter((l) => l.enabled);
    const sum = enabled.reduce((s, l) => s + Number(l.strength_model || 0), 0);
    $("lora-sum").textContent = list.length ? `${enabled.length} активны · Σ ${sum.toFixed(2)}` : "только добавленные";
    const rows = list.map((l) => {
      const base = U.fileBase(l.name);
      const triggers = (l.triggers || []).map((t, i) =>
        `<button type="button" class="tw ${t.enabled === false ? "" : "on"}" data-trig="${i}" data-lora-name="${escapeHtml(l.name)}">${t.enabled === false ? "" : "✓ "}${escapeHtml(t.text)}</button>`
      ).join(" ");
      const open = state.loraSelected === l.name;
      if (l.role === "task") return taskRowHtml(l);
      return `<div class="lora-row ${l.enabled ? "" : "off"}">
        <button type="button" class="cb ${l.enabled ? "on" : ""}" data-lora-enable="${escapeHtml(l.name)}" title="Включить или выключить"></button>
        <button type="button" class="nm" data-lora-info="${escapeHtml(l.name)}" title="${escapeHtml(l.name)}">${escapeHtml(base)}</button>
        <input class="range" data-str="model" data-lora-name="${escapeHtml(l.name)}" type="range" min="0" max="2" step="0.05" value="${Number(l.strength_model)}" title="Сила">
        <input class="f" data-str-num="model" data-lora-name="${escapeHtml(l.name)}" value="${Number(l.strength_model).toFixed(2)}" title="Сила">
        <button type="button" class="b s" data-lora-remove="${escapeHtml(l.name)}" title="Убрать из стека">×</button>
      </div>
      ${open ? `<div class="row" style="flex-wrap:wrap;gap:4px">${triggers || `<span class="mu">Нет триггеров.</span>`}
        <button type="button" class="b s" data-civitai="1" data-lora-name="${escapeHtml(l.name)}">Civitai</button></div>` : ""}`;
    }).join("");
    $("lora-panel").innerHTML = `<div class="lora-stack">
      <button type="button" class="b" id="btn-lora-add">+ Добавить LoRA</button>
      ${rows || `<div class="empty">В стеке пусто. Добавьте LoRA из папки models/loras — весь каталог здесь не показывается.</div>`}
    </div>`;
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons($("lora-panel"));
    sealCollapsed($("lora-node"));
  }

  function loraListing(path, query) {
    const files = state.loras || [];
    const q = (query || "").trim().toLowerCase();
    if (q) return { folders: [], files: files.filter((n) => n.toLowerCase().includes(q)).sort() };
    const prefix = path ? path.replace(/\/+$/, "") + "/" : "";
    const folders = new Set();
    const here = [];
    for (const raw of files) {
      const name = U.normalizeSlashes(raw);
      if (prefix && !name.startsWith(prefix)) continue;
      const rest = prefix ? name.slice(prefix.length) : name;
      const slash = rest.indexOf("/");
      if (slash >= 0) folders.add(rest.slice(0, slash));
      else here.push(raw);
    }
    return { folders: [...folders].sort(), files: here.sort() };
  }

  function knownPreview(name) {
    const l = activeLoras().find((x) => x.name === name);
    return (l && l.civitai && l.civitai.preview) || "";
  }

  function openLoraPicker(opts) {
    const swapTask = !!(opts && opts.swapTask);
    state.loraBrowse = state.loraBrowse || "";
    openModal(`<h3>${swapTask ? "Файл LoRA режима" : "Добавить LoRA"}</h3><div id="lora-picker"></div>`, (box, close) => {
      box.classList.add("wide");
      const ok = box.querySelector("[data-ok]");
      ok.textContent = "Готово";
      ok.onclick = () => close();
      const paint = () => {
        const host = $("lora-picker");
        if (!host) return;
        const path = state.loraBrowse || "";
        const q = state.loraPickQuery || "";
        const listed = loraListing(path, q);
        const parts = path ? path.split("/") : [];
        let acc = "";
        const crumbs = [`<button type="button" class="b s" data-crumb="">loras</button>`].concat(parts.map((part) => {
          acc = acc ? acc + "/" + part : part;
          return `<button type="button" class="b s" data-crumb="${escapeHtml(acc)}">${escapeHtml(part)}</button>`;
        })).join("");
        const added = new Set(activeLoras().map((l) => l.name));
        const dirs = q ? "" : listed.folders.map((f) => {
          const next = path ? path + "/" + f : f;
          return `<button type="button" class="lora-dir" data-enter="${escapeHtml(next)}"><span class="lora-ph"></span><span class="nm">${escapeHtml(f)}</span><span class="mu">папка</span></button>`;
        }).join("");
        const rows = listed.files.map((name) => {
          const preview = knownPreview(name);
          const thumb = preview ? `<img src="${escapeHtml(preview)}" alt="">` : `<span class="lora-ph"></span>`;
          const mark = added.has(name) ? `<span class="tag tgr">добавлена</span>` : "";
          return `<button type="button" class="lora-file" data-pick="${escapeHtml(name)}">${thumb}<span class="nm" title="${escapeHtml(name)}">${escapeHtml(q ? U.normalizeSlashes(name) : U.fileBase(name))}</span>${mark}</button>`;
        }).join("");
        host.innerHTML = `
          <input id="lora-pick-search" class="f" style="width:100%;font-family:inherit" placeholder="Поиск по всем папкам" value="${escapeHtml(q)}">
          <div class="lora-crumbs">${crumbs}</div>
          <div class="lora-pick-list">${dirs}${rows || `<div class="empty">В этой папке пусто.</div>`}</div>
          <div class="mu">Выберите файл, чтобы добавить его в стек.</div>`;
        const search = $("lora-pick-search");
        search.oninput = () => {
          state.loraPickQuery = search.value;
          const pos = search.selectionStart;
          paint();
          const again = $("lora-pick-search");
          if (again) { again.focus(); again.setSelectionRange(pos, pos); }
        };
        host.onclick = (ev) => {
          const crumb = ev.target.closest("[data-crumb]");
          const enter = ev.target.closest("[data-enter]");
          const pick = ev.target.closest("[data-pick]");
          if (crumb) { state.loraBrowse = crumb.dataset.crumb || ""; state.loraPickQuery = ""; paint(); }
          if (enter) { state.loraBrowse = enter.dataset.enter; state.loraPickQuery = ""; paint(); }
          if (pick) {
            if (swapTask) {
              const row = taskLoraRow();
              if (row) row.name = pick.dataset.pick;
              rememberTaskLora();
            } else ensureLora(pick.dataset.pick);
            renderLoras(); renderPipe(); updateGenerateButton(); paint();
          }
        };
      };
      paint();
    });
  }

  function renderLoraLibrary() {
    const searchEl = document.activeElement && document.activeElement.id === "lora-search" ? document.activeElement : null;
    const caret = searchEl ? searchEl.selectionStart : null;
    const files = state.loras || [];
    const enabled = activeLoras().filter((l) => l.enabled);
    const sum = enabled.reduce((s, l) => s + Number(l.strength_model || 0), 0);
    $("lora-sum").textContent = `каталог ${files.length} · в стеке ${enabled.length}`;
    const q = state.loraQuery.toLowerCase();
    const folder = state.loraFolder;
    const shown = files.filter((name) => {
      const path = U.normalizeSlashes(name);
      if (folder && path !== folder && !path.startsWith(folder + "/")) return false;
      if (q && !path.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, document.body.dataset.tab === "lora" ? 500 : 80);
    const folders = {};
    files.forEach((name) => {
      const path = U.normalizeSlashes(name);
      const top = path.includes("/") ? path.split("/")[0] : "";
      folders[top] = (folders[top] || 0) + 1;
    });
    const tree = [`<button type="button" class="fld ${folder === "" ? "on" : ""}" data-folder="">Все<span class="c">${files.length}</span></button>`]
      .concat(Object.keys(folders).filter(Boolean).sort().map((f) =>
        `<button type="button" class="fld ${folder === f ? "on" : ""}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}<span class="c">${folders[f]}</span></button>`
      )).join("");
    const rows = shown.map((name) => {
      const base = U.fileBase(name);
      const hit = activeLoras().find((l) => l.name === name);
      const on = hit && hit.enabled;
      return `<tr data-lora="${escapeHtml(name)}" class="${state.loraSelected === name ? "on" : ""}"><td><span class="cb ${on ? "on" : ""}" data-lora-toggle="${escapeHtml(name)}"></span></td><td>${escapeHtml(base)}</td><td class="mono">${on ? Number(hit.strength_model).toFixed(2) : "—"}</td><td class="mono">${on && hit.triggers ? hit.triggers.filter((t) => t.enabled !== false).length : ""}</td></tr>`;
    }).join("");
    const sel = activeLoras().find((l) => l.name === state.loraSelected) || null;
    const detail = sel ? loraDetail(sel) : `<div class="empty">Выберите LoRA в списке. Список читается из папки loras ComfyUI.</div>`;
    const task = isKreaEdit() ? taskLoraRow() : null;
    $("lora-panel").innerHTML = `
      ${task ? `<div class="lora-stack">${taskRowHtml(task)}</div>` : ""}
      <div class="row"><input id="lora-search" class="f" style="flex:1;font-family:inherit" placeholder="Поиск: имя, тег, триггер…" value="${escapeHtml(state.loraQuery)}"></div>
      <div class="lora-split">
        <div class="tree">${tree}</div>
        <div class="lora-table">
          <table class="lt"><tr><th></th><th>Имя</th><th>Сила</th><th>Триг.</th></tr>${rows || `<tr><td></td><td class="mu" colspan="3">${files.length ? "Ничего не найдено" : "Папка loras пуста"}</td></tr>`}</table>
        </div>
      </div>
      <div id="lora-detail">${detail}</div>`;
    const search = $("lora-search");
    if (search) {
      search.addEventListener("input", () => { state.loraQuery = search.value; renderLoras(); });
      if (searchEl) {
        search.focus();
        const pos = caret == null ? search.value.length : caret;
        search.setSelectionRange(pos, pos);
      }
    }
  }

  function loraDetail(l) {
    const triggers = (l.triggers || []).map((t, i) =>
      `<button type="button" class="tw ${t.enabled === false ? "" : "on"}" data-trig="${i}">${t.enabled === false ? "" : "✓ "}${escapeHtml(t.text)}</button>`
    ).join(" ") || `<span class="mu">триггеры появятся после Civitai</span>`;
    const info = l.civitai;
    const foot = info
      ? `civitai · ${escapeHtml(info.base_model || "")} · ${info.size_kb ? Math.round(info.size_kb / 1024) + " МБ" : ""} · ★${info.rating != null ? Number(info.rating).toFixed(1) : "—"} · ${info.download_count || 0} загрузок`
      : (l.sha256 ? "sha256 " + l.sha256.slice(0, 12) + "…" : "хеш ещё не считался");
    return `<div style="border:1px solid var(--ln);border-radius:6px;padding:8px;background:#16191e;display:flex;flex-direction:column;gap:7px">
      <div class="row"><b style="font-size:12.5px">${escapeHtml(U.fileBase(l.name))}</b><span class="tag tvi">${escapeHtml((info && info.base_model) || "LoRA")}</span>
        <button class="b s" data-civitai="1" style="margin-left:auto;color:var(--bl)" data-i="link" data-s="12">Civitai info</button></div>
      <div class="row"><span class="mu" style="width:62px">Model</span><input class="range" data-str="model" type="range" min="0" max="2" step="0.01" value="${l.strength_model}"><input class="f" data-str-num="model" style="width:48px" value="${Number(l.strength_model).toFixed(2)}"></div>
      <div class="row"><span class="mu" style="width:62px">CLIP</span><input class="range" data-str="clip" type="range" min="0" max="2" step="0.01" value="${l.strength_clip}"><input class="f" data-str-num="clip" style="width:48px" value="${Number(l.strength_clip).toFixed(2)}"></div>
      <div class="row" style="flex-wrap:wrap;gap:5px"><span class="mu" style="width:62px">Триггеры</span>${triggers}</div>
      <div class="row"><span class="mu" style="width:62px">Вставка</span>
        <select class="dd" data-trig-mode="1" style="flex:1">
          <option value="end" ${l.trigger_mode === "end" ? "selected" : ""}>Авто: добавлять триггеры в конец промта</option>
          <option value="start" ${l.trigger_mode === "start" ? "selected" : ""}>Авто: в начало промта</option>
          <option value="off" ${!l.trigger_mode || l.trigger_mode === "off" ? "selected" : ""}>Не добавлять</option>
        </select></div>
      <div class="mu mono" style="font-size:10.5px">${foot}</div>
    </div>`;
  }

  function ensureLora(name) {
    let l = activeLoras().find((x) => x.name === name);
    if (!l) {
      l = { name, enabled: true, strength_model: 0.8, strength_clip: 0.8, trigger_mode: "end", triggers: [] };
      activeLoras().push(l);
    }
    return l;
  }

  function renderSampler() {
    const s = state.sampler;
    const cat = state.catalog || { samplers: ["euler"], schedulers: ["simple", "normal", "beta"] };
    const opt = (list, cur) => (list || []).map((n) => `<option ${n === cur ? "selected" : ""}>${escapeHtml(n)}</option>`).join("");
    $("sampler-box").innerHTML = `
      <span>Seed</span><div class="row seed-row"><input id="seed" class="f" value="${U.finiteNumber(s.seed, 0)}" title="Последний сид. В режиме «случайный» каждый запуск берёт новый."><button class="b s" id="btn-seed" data-i="dice" data-s="12" type="button" title="Случайный сид"></button>
        <select id="seed-mode" class="dd" title="Режим сида"><option value="random" ${s.seedMode === "random" ? "selected" : ""}>случайный</option><option value="fixed" ${s.seedMode === "fixed" ? "selected" : ""}>фиксированный</option><option value="increment" ${s.seedMode === "increment" ? "selected" : ""}>+1</option></select></div>
      <span>Шаги</span><div class="row"><input id="steps-range" class="range" type="range" min="1" max="80" value="${U.finiteNumber(s.steps, 20)}"><input id="steps" class="f" style="width:48px" value="${U.finiteNumber(s.steps, 20)}"></div>
      <span>CFG</span><div class="row"><input id="cfg-range" class="range" type="range" min="0" max="12" step="0.1" value="${U.finiteNumber(s.cfg, 7)}"><input id="cfg" class="f" style="width:48px" value="${U.finiteNumber(s.cfg, 7)}"></div>
      <span>Denoise</span><div class="row"><input id="denoise-range" class="range" type="range" min="0" max="1" step="0.01" value="${U.finiteNumber(s.denoise, 1)}"><input id="denoise" class="f" style="width:48px" value="${U.finiteNumber(s.denoise, 1)}"></div>
      <span>Сэмплер</span><select id="sampler" class="dd">${opt(cat.samplers, s.sampler)}</select>
      <span>Планировщик</span><select id="scheduler" class="dd">${opt(cat.schedulers, s.scheduler)}</select>
      <span>Батч</span><input id="batch" class="f" value="${U.finiteNumber(s.batch, 1)}">
    `;
    $("gen-batch").textContent = `×${s.batch}`;
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons($("sampler-box"));
    bindSampler();
  }

  function bindSampler() {
    const link = (range, num, key, parse) => {
      const a = $(range), b = $(num);
      if (!a || !b) return;
      const apply = (v) => { state.sampler[key] = parse(v); a.value = state.sampler[key]; b.value = state.sampler[key]; renderPipe(); };
      a.oninput = () => apply(a.value);
      b.onchange = () => apply(b.value);
    };
    link("steps-range", "steps", "steps", (v) => Math.max(1, parseInt(v, 10) || 1));
    link("cfg-range", "cfg", "cfg", (v) => Math.max(0, parseFloat(v) || 0));
    link("denoise-range", "denoise", "denoise", (v) => Math.min(1, Math.max(0, parseFloat(v) || 0)));
    $("seed").onchange = () => { state.sampler.seed = Math.max(0, parseInt($("seed").value, 10) || 0); if (state.sampler.seedMode === "random") state.sampler.seedMode = "fixed"; if ($("seed-mode")) $("seed-mode").value = state.sampler.seedMode; };
    $("seed-mode").onchange = () => { state.sampler.seedMode = $("seed-mode").value; };
    $("sampler").onchange = () => { state.sampler.sampler = $("sampler").value; renderPipe(); };
    $("scheduler").onchange = () => { state.sampler.scheduler = $("scheduler").value; };
    $("batch").onchange = () => { state.sampler.batch = Math.max(1, Math.min(8, parseInt($("batch").value, 10) || 1)); $("gen-batch").textContent = `×${state.sampler.batch}`; };
    $("btn-seed").onclick = () => { state.sampler.seed = Math.floor(Math.random() * 1e9); $("seed").value = state.sampler.seed; };
  }

  const ASPECTS = [["1:1", 1, 1], ["2:3", 2, 3], ["3:2", 3, 2], ["3:4", 3, 4], ["4:3", 4, 3], ["9:16", 9, 16], ["16:9", 16, 9], ["21:9", 21, 9]];
  const MPS = [0.5, 1, 1.5, 2, 3, 4];

  function gcd(a, b) {
    a = Math.abs(a | 0); b = Math.abs(b | 0);
    while (b) { const t = b; b = a % b; a = t; }
    return a || 1;
  }
  function snapSize(n, step = 16, minimum = 64) {
    return window.ZeroImageStudioSize.snapSize(n, step, minimum);
  }
  function matchAspect(w, h) {
    if (!w || !h) return "custom";
    const r = w / h;
    let best = "custom", err = 0.035;
    for (const [name, aw, ah] of ASPECTS) {
      const target = aw / ah;
      const e = Math.abs(r - target) / target;
      if (e < err) { err = e; best = name; }
    }
    return best;
  }
  function ratioText(w, h) {
    const name = matchAspect(w, h);
    if (name !== "custom") return name;
    const g = gcd(Math.round(w), Math.round(h));
    return Math.round(w / g) + ":" + Math.round(h / g);
  }
  function nearestMp(w, h) {
    const mp = (w * h) / 1e6;
    return MPS.reduce((best, m) => Math.abs(m - mp) < Math.abs(best - mp) ? m : best, MPS[0]);
  }
  function activeMp(w, h) {
    const mp = (w * h) / 1e6;
    let best = null;
    let err = 0.08;
    for (const m of MPS) {
      const e = Math.abs(m - mp);
      if (e < err) { err = e; best = m; }
    }
    return best;
  }
  function modelStep() {
    const c = cfg();
    if (c.method === "krea2_edit" || c.latent_mode === "sd3" || c.encoder === "qwen_image_21" || c.method === "qwen_image_21" || c.method === "qwen_image") return 16;
    return 8;
  }
  function editIsRegion() {
    return state.pipeline === "edit" && state.area.editScope === "region";
  }
  function generationSize() {
    const step = modelStep();
    if (!editor || !editIsRegion()) {
      const w = snapSize(editor ? editor.doc.w : state.area.outW, step);
      const h = snapSize(editor ? editor.doc.h : state.area.outH, step);
      state.area.outW = w;
      state.area.outH = h;
      return { w, h };
    }
    const g = editor.gen;
    const frame = window.ZeroImageStudioSize.sizeForMegapixels(g.w, g.h, state.area.mp || 1, step);
    state.area.outW = frame.w;
    state.area.outH = frame.h;
    return frame;
  }
  function applyEditScope(scope) {
    const next = scope === "region" ? "region" : "full";
    state.area.editScope = next;
    if (!editor) return;
    if (next === "region") {
      if (state.area.region) editor.gen = { ...state.area.region };
      editor.gen = window.ZeroImageStudioSize.snapRect(editor.gen, modelStep(), editor.doc);
      state.area.region = { x: editor.gen.x, y: editor.gen.y, w: editor.gen.w, h: editor.gen.h };
      state.area.userPlaced = true;
      state.area.outputLinked = false;
    } else {
      if (state.area.userPlaced) state.area.region = { x: editor.gen.x, y: editor.gen.y, w: editor.gen.w, h: editor.gen.h };
      state.area.userPlaced = false;
      state.area.outputLinked = true;
      syncDefaultArea();
    }
    editor.requestDraw();
    renderInspector();
    renderPipe();
    paintStatus();
  }
  function sizeForAspectMp(aspect, mp) {
    const hit = ASPECTS.find((a) => a[0] === aspect) || ASPECTS[0];
    const ratio = hit[1] / hit[2];
    const pixels = Math.max(0.25, Number(mp) || 1) * 1e6;
    const h = Math.sqrt(pixels / ratio);
    return { w: snapSize(h * ratio), h: snapSize(h) };
  }
  function coversWholeCanvas() {
    if (!editor) return !state.area.userPlaced;
    if (editor.maskArea() > 8) return false;
    if (!state.area.userPlaced) return true;
    const g = editor.gen;
    return g.x <= 1 && g.y <= 1 && g.w >= editor.doc.w - 2 && g.h >= editor.doc.h - 2;
  }
  function replacesCanvas() {
    return state.pipeline === "create" && coversWholeCanvas();
  }
  function syncOutputFromCanvas() {
    if (!editor) return;
    state.area.outW = snapSize(editor.doc.w);
    state.area.outH = snapSize(editor.doc.h);
    state.area.mp = nearestMp(state.area.outW, state.area.outH);
  }
  function resolutionPickerHtml(w, h) {
    const aspect = matchAspect(w, h);
    const mpOn = activeMp(w, h);
    const exact = ((w * h) / 1e6).toFixed(2);
    return `<div class="res-pick">
      <div class="mu">Соотношение</div>
      <div class="res-aspects">${ASPECTS.map(([n]) => `<button type="button" class="b s ${aspect === n ? "on" : ""}" data-aspect="${n}" aria-pressed="${aspect === n ? "true" : "false"}">${n}</button>`).join("")}<button type="button" class="b s" data-swap="1" title="Портрет или альбом">⇄</button></div>
      <div class="mu">Мегапиксели</div>
      <div class="res-mps">${MPS.map((m) => `<button type="button" class="b s ${m === mpOn ? "on" : ""}" data-mp="${m}" aria-pressed="${m === mpOn ? "true" : "false"}">${m}</button>`).join("")}<button type="button" class="b s" data-custom="1" aria-pressed="false">Своё</button></div>
      <div class="row res-wh"><input class="f" data-rw="1" value="${w}" inputmode="numeric" aria-label="Ширина"><span>×</span><input class="f" data-rh="1" value="${h}" inputmode="numeric" aria-label="Высота"><span class="mu res-live">${w}×${h} · ${exact} МП · кратно 16</span></div>
    </div>`;
  }
  function bindResolutionPicker(root, onSize) {
    if (!root) return;
    const read = () => ({
      w: snapSize(parseInt(root.querySelector("[data-rw]").value, 10) || 64),
      h: snapSize(parseInt(root.querySelector("[data-rh]").value, 10) || 64),
    });
    root.addEventListener("click", (e) => {
      const aspectBtn = e.target.closest("[data-aspect]");
      const mpBtn = e.target.closest("[data-mp]");
      const swap = e.target.closest("[data-swap]");
      const custom = e.target.closest("[data-custom]");
      const cur = read();
      if (aspectBtn) {
        const size = sizeForAspectMp(aspectBtn.dataset.aspect, nearestMp(cur.w, cur.h));
        onSize(size.w, size.h);
      } else if (mpBtn) {
        const ratio = cur.w / cur.h || 1;
        const pixels = Math.max(0.25, parseFloat(mpBtn.dataset.mp) || 1) * 1e6;
        const h = Math.sqrt(pixels / ratio);
        onSize(snapSize(h * ratio), snapSize(h));
      } else if (swap) onSize(cur.h, cur.w);
      else if (custom) root.querySelector("[data-rw]").focus();
    });
    root.querySelectorAll("[data-rw],[data-rh]").forEach((input) => {
      input.addEventListener("change", () => { const cur = read(); onSize(cur.w, cur.h); });
    });
  }
  function useWholeCanvas() {
    state.area.userPlaced = false;
    state.area.outputLinked = true;
    syncDefaultArea();
    if (editor) editor.requestDraw();
    renderInspector();
    renderPipe();
    renderLayers();
    paintStatus();
  }

  function inspectorContext() {
    const layer = editor && editor.activeLayer && editor.activeLayer();
    if (state.tool !== "genarea" && layer) return layer.name;
    return coversWholeCanvas() ? "весь холст" : "область";
  }

  function applyOutputSize(w, h) {
    state.area.outputLinked = false;
    state.area.outW = snapSize(w);
    state.area.outH = snapSize(h);
    state.area.mp = nearestMp(state.area.outW, state.area.outH);
    if (editor) editor.requestDraw();
    renderInspector();
    renderPipe();
    paintStatus();
  }

  function renderInspector() {
    const frame = generationSize();
    const g = editor.gen;
    const a = state.area;
    const exact = ((frame.w * frame.h) / 1e6).toFixed(2);
    const meta = $("insp-meta");
    const region = editIsRegion();
    if (meta) meta.textContent = region ? "область" : "весь холст";
    const full = $("btn-gen-full");
    if (full) full.hidden = true;
    const mpChoices = [0.5, 1, 1.5, 2];
    const mpCustom = !mpChoices.includes(Number(a.mp));
    const mpButtons = mpChoices.map((m) => `<button type="button" class="b s ${Number(a.mp) === m ? "on" : ""}" data-area-mp="${m}">${m}</button>`).join("")
      + `<button type="button" class="b s ${mpCustom ? "on" : ""}" data-area-mp="custom">Своё</button>`;
    const scope = state.pipeline === "edit" ? `<div class="scope-toggle" role="group" aria-label="Что править">
        <button type="button" data-edit-scope="full" class="${region ? "" : "on"}">Весь холст</button>
        <button type="button" data-edit-scope="region" class="${region ? "on" : ""}">Область</button>
      </div>` : "";
    const regionBody = region ? `
        <div class="insp-h">Мегапиксели</div>
        <div class="mp-row">${mpButtons}${mpCustom ? `<input id="g-mp-custom" class="f" inputmode="decimal" aria-label="Своё значение в мегапикселях" value="${Number(a.mp) || 1}" style="width:64px">` : ""}</div>
        <div class="mu">Пропорцию берёт рамка на холсте. Углы и край рамки двигаются любым инструментом.</div>
        <details class="insp-adv" id="insp-exact" ${a.exactOpen ? "open" : ""}>
          <summary>Точно</summary>
          <div class="insp-grid">
            <span class="lbl">X</span><input id="gx" class="f" value="${Math.round(g.x)}" inputmode="numeric" aria-label="X">
            <span class="lbl">Y</span><input id="gy" class="f" value="${Math.round(g.y)}" inputmode="numeric" aria-label="Y">
            <span class="lbl">W</span><input id="gw" class="f" value="${Math.round(g.w)}" inputmode="numeric" aria-label="Ширина области">
            <span class="lbl">H</span><input id="gh" class="f" value="${Math.round(g.h)}" inputmode="numeric" aria-label="Высота области">
          </div>
        </details>
        <details class="insp-adv" id="insp-paste" ${a.pasteOpen ? "open" : ""}>
          <summary>Вклейка</summary>
          <div class="insp-grid">
            <span class="lbl">Режим</span>
            <select id="gpaste" class="dd insp-span" aria-label="Режим вклейки">
              <option value="poisson" ${a.paste === "poisson" ? "selected" : ""}>Poisson</option>
              <option value="feather" ${a.paste === "feather" ? "selected" : ""}>Растушёвка</option>
              <option value="hard" ${a.paste === "hard" ? "selected" : ""}>Жёстко</option>
            </select>
            <span class="lbl">Шов</span><input id="gfeather" class="f" value="${a.feather}" inputmode="numeric" aria-label="Шов, пиксели">
            <span class="lbl">Контекст</span>
            <div class="insp-inline"><input id="gcontext" class="f" value="${Math.round(a.context * 100)}" inputmode="numeric" aria-label="Контекст, проценты" style="width:72px;flex:0 0 72px"><span class="mu">%</span></div>
            <span class="lbl">Цвет</span>
            <label class="insp-span insp-check"><input id="gcolor" type="checkbox" ${a.colorMatch ? "checked" : ""}> подгон</label>
          </div>
        </details>` : `<div class="mu">${state.pipeline === "create" ? "Размер холста и генерации совпадают." : "Генерация на весь холст, без рамки."}</div>`;
    $("inspector").innerHTML = `<div class="insp">${scope}
        <div class="insp-result">${frame.w}×${frame.h} · ${exact} МП</div>
        ${regionBody}
      </div>`;
    $("inspector").querySelectorAll("[data-edit-scope]").forEach((btn) => {
      btn.onclick = () => applyEditScope(btn.dataset.editScope);
    });
    $("inspector").querySelectorAll("[data-area-mp]").forEach((btn) => {
      btn.onclick = () => {
        if (btn.dataset.areaMp === "custom") {
          state.area.mp = Number(state.area.mp) || 1;
          if ([0.5, 1, 1.5, 2].includes(Number(state.area.mp))) state.area.mp = 1.25;
          renderInspector();
          const input = $("g-mp-custom");
          if (input) { input.focus(); input.select(); }
          return;
        }
        state.area.mp = parseFloat(btn.dataset.areaMp) || 1;
        renderInspector();
        if (editor) editor.requestDraw();
      };
    });
    const custom = $("g-mp-custom");
    if (custom) custom.onchange = () => { state.area.mp = Math.max(0.25, parseFloat(custom.value) || 1); renderInspector(); if (editor) editor.requestDraw(); };
    const num = (id, fn) => { const el = $(id); if (el) el.onchange = () => { fn(parseFloat(el.value)); editor.gen = window.ZeroImageStudioSize.snapRect(editor.gen, modelStep(), editor.doc); state.area.region = { ...editor.gen }; editor.requestDraw(); renderInspector(); }; };
    num("gx", (v) => { editor.gen.x = v || 0; });
    num("gy", (v) => { editor.gen.y = v || 0; });
    num("gw", (v) => { editor.gen.w = Math.max(16, v || 16); });
    num("gh", (v) => { editor.gen.h = Math.max(16, v || 16); });
    const exactBox = $("insp-exact");
    if (exactBox) exactBox.addEventListener("toggle", () => { state.area.exactOpen = exactBox.open; });
    const paste = $("insp-paste");
    if (paste) {
      paste.addEventListener("toggle", () => { state.area.pasteOpen = paste.open; });
      $("gpaste").onchange = () => { state.area.paste = $("gpaste").value; };
      $("gfeather").onchange = () => { state.area.feather = Math.max(0, parseInt($("gfeather").value, 10) || 0); };
      $("gcontext").onchange = () => { state.area.context = Math.max(0, (parseFloat($("gcontext").value) || 0) / 100); };
      $("gcolor").onchange = () => { state.area.colorMatch = $("gcolor").checked; };
    }
  }

  function renderTags() { /* status lives in the tool options bar */ }

  function renderToolOptions() {
    const host = $("tool-options");
    if (!host || !editor) return;
    const tool = state.tool;
    const b = state.brush;
    if (tool === "brush" || tool === "eraser" || tool === "mask") {
      const title = tool === "mask" ? "Маска" : (tool === "eraser" ? "Ластик" : "Кисть");
      host.innerHTML = `<b>${title}</b>
        <label>Размер <input id="brush-size" class="range" type="range" min="1" max="300" value="${b.size}" title="Размер кисти ([ и ])"></label>
        <label>Жёсткость <input id="brush-hard" class="range" type="range" min="0" max="100" value="${Math.round(b.hardness * 100)}" title="Жёсткость"></label>
        <label>Непрозр. <input id="brush-op" class="range" type="range" min="1" max="100" value="${Math.round(b.opacity * 100)}" title="Непрозрачность"></label>
        <span class="mu" id="opt-status"></span>`;
      $("brush-size").oninput = () => { state.brush.size = parseInt($("brush-size").value, 10) || 1; paintStatus(); };
      $("brush-hard").oninput = () => { state.brush.hardness = (parseInt($("brush-hard").value, 10) || 0) / 100; paintStatus(); };
      $("brush-op").oninput = () => { state.brush.opacity = Math.min(1, (parseInt($("brush-op").value, 10) || 1) / 100); paintStatus(); };
      paintStatus();
    } else if (tool === "genarea") {
      host.innerHTML = `<b>Область</b><span class="mu" id="opt-status"></span>`;
      paintStatus();
    } else {
      const hints = {
        move: "Перемещение слоя (V). Пробел — панорама.",
        select: "Прямоугольное выделение (M).",
        lasso: "Лассо (L).",
        transform: "Масштаб слоя перетаскиванием (T).",
        crop: "Кадрирование холста (C).",
        eyedrop: "Пипетка (I) — цвет кисти.",
        hand: "Рука (H или пробел).",
        zoom: "Масштаб (Z). Колёсико крутит вокруг курсора. Ctrl+0 вмещает, Ctrl+1 — 100%.",
      };
      host.innerHTML = `<span class="mu">${hints[tool] || "Выберите инструмент."}</span>`;
    }
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
  }

  function paintStatus() {
    const el = $("opt-status");
    if (!el || !editor) return;
    if (state.tool === "mask" || state.tool === "brush" || state.tool === "eraser") {
      const area = editor.maskArea();
      el.textContent = area > 8 ? `маска ${area} px²` : "маска не нарисована";
    } else if (state.tool === "genarea") {
      generationSize();
      el.textContent = window.ZeroImageStudioSize.areaStatusText(editor.doc, state.area);
    }
  }

  function syncDefaultArea() {
    if (!editor || state.area.userPlaced) return;
    editor.gen = { x: 0, y: 0, w: editor.doc.w, h: editor.doc.h };
    if (state.area.outputLinked !== false) syncOutputFromCanvas();
  }

  function isKreaEdit() {
    return state.pipeline === "edit" && cfg().method === "krea2_edit";
  }

  function kreaTaskId() {
    const task = cfg().krea && cfg().krea.task;
    return task === "identity" ? "identity" : "general";
  }

  function basenameOf(name) {
    return U.basenameOf(name);
  }

  function catalogHas(list, name) {
    if (!name) return false;
    const want = basenameOf(name);
    return (list || []).some((n) => basenameOf(n) === want || String(n).toLowerCase() === String(name).toLowerCase());
  }

  function findInstalledLora(file) {
    const want = basenameOf(file);
    return (state.loras || []).find((n) => basenameOf(n) === want) || "";
  }

  function sceneOnCanvas() {
    return !!(editor && editor.layers.some((l) => l.visible));
  }

  function applyKreaPlacement(taskId) {
    const k = state.edit.krea;
    if (!k) return;
    const id = taskId === "identity" ? "identity" : "general";
    k.task = id;
    const scene = sceneOnCanvas();
    if (id === "identity" && scene) k.ref_position = "beside (right of target)";
    else k.ref_position = "aligned (trained)";
    k.ref_position_a = "aligned (trained)";
  }

  function applyKreaTaskDefaults(taskId) {
    const id = taskId === "identity" ? "identity" : "general";
    const task = KREA_TASKS[id];
    const k = state.edit.krea;
    k.task = id;
    k.grounding_px = task.grounding;
    applyKreaPlacement(id);
  }

  function setKreaTask(taskId) {
    rememberTaskLora();
    applyKreaTaskDefaults(taskId);
    syncKreaStack();
    renderFiles();
    renderKreaChrome();
    renderRefs();
    renderLoras();
    renderPipe();
    updateGenerateButton();
  }

  const TASK_LORA_KEY = "zeroimagestudio.kreaTaskLora";

  function taskSlotKey(hintId, task) {
    const id = canonicalHintId(hintId || state.hintId);
    return id + ":" + (task === "identity" ? "identity" : "general");
  }

  function loadTaskSlots() {
    if (state._taskSlotsLoaded) return;
    state._taskSlotsLoaded = true;
    try {
      const raw = JSON.parse(localStorage.getItem(TASK_LORA_KEY) || "{}");
      if (raw && typeof raw === "object") state.kreaTaskSlots = raw;
    } catch { state.kreaTaskSlots = {}; }
  }

  function saveTaskSlots() {
    try { localStorage.setItem(TASK_LORA_KEY, JSON.stringify(state.kreaTaskSlots || {})); } catch { /* private mode */ }
  }

  function taskLoraRow() {
    return (state.edit.loras || []).find((l) => l && l.role === "task") || null;
  }

  function rememberTaskLora() {
    if (!isKreaEdit()) return;
    const row = taskLoraRow();
    if (!row || !String(row.name || "").trim()) return;
    loadTaskSlots();
    state.kreaTaskSlots[taskSlotKey(state.hintId, kreaTaskId())] = {
      name: row.name,
      strength_model: Number(row.strength_model),
      strength_clip: Number(row.strength_clip),
      enabled: row.enabled !== false,
    };
    saveTaskSlots();
  }

  function syncKreaStack() {
    const edit = state.edit;
    if (!edit.krea) edit.krea = blankPipe("edit").krea;
    loadTaskSlots();
    const prior = (edit.loras || []).find((l) => l && (l.role === "task" || l.system));
    const extras = (edit.loras || []).filter((l) => l && l.role !== "task" && !l.system);
    if (!isKreaEdit()) {
      edit.loras = extras;
      return;
    }
    const id = edit.krea.task === "identity" ? "identity" : "general";
    edit.krea.task = id;
    const suggested = findInstalledLora(KREA_TASKS[id].file) || KREA_TASKS[id].file;
    const choice = U.resolveTaskLora(state.kreaTaskSlots[taskSlotKey(state.hintId, id)], suggested);
    const same = prior && basenameOf(prior.name) === basenameOf(choice.name);
    const row = {
      name: choice.name,
      strength_model: choice.strength_model,
      strength_clip: choice.strength_clip,
      enabled: choice.enabled,
      trigger_mode: same && prior.trigger_mode ? prior.trigger_mode : "off",
      triggers: same ? (prior.triggers || []) : [],
      role: "task",
    };
    if (same && prior.civitai) row.civitai = prior.civitai;
    if (same && prior.sha256) row.sha256 = prior.sha256;
    const taskBase = basenameOf(row.name);
    edit.loras = [row, ...extras.filter((l) => basenameOf(l.name) !== taskBase)];
  }

  function kreaRefHint() {
    applyKreaPlacement(kreaTaskId());
    if (kreaTaskId() === "identity") {
      return sceneOnCanvas()
        ? "Холст — сцена, первый референс — человек (справа от кадра)."
        : "Нет сцены на холсте: первый референс — единственный кадр человека.";
    }
    return "Холст — исходник правки. Дополнительный референс не отправляется.";
  }

  function renderKreaChrome() {
    const host = $("krea-task");
    const tips = $("krea-tips");
    const on = isKreaEdit();
    if (host) host.hidden = !on;
    if (tips) tips.hidden = !on;
    if (!on) {
      renderModelWarn();
      return;
    }
    const task = kreaTaskId();
    if (host) {
      host.innerHTML = `
        <button type="button" data-krea-task="general" class="${task === "general" ? "on" : ""}" aria-pressed="${task === "general"}" title="Правка — General Edit V2">Правка</button>
        <button type="button" data-krea-task="identity" class="${task === "identity" ? "on" : ""}" aria-pressed="${task === "identity"}" title="Персонаж по референсу — Identity Edit V2">Персонаж</button>`;
    }
    if (tips) {
      const frame = editor ? generationSize() : { w: 0, h: 0 };
      const mp = (frame.w * frame.h) / 1e6;
      const over = mp > 2;
      const removal = U.requestsRemoval(state.prompt || "");
      tips.innerHTML = `
        <div class="${over ? "hot" : "mu"}">До 2 Мп для Krea Edit.${over ? ` Сейчас ${mp.toFixed(2)} — выше исходник может протекать, а объект двоиться.` : ""}</div>
        <div class="${removal ? "hot" : "mu"}">Для удаления объекта — модель Raw, CFG около 3, около 20 шагов.</div>`;
    }
    renderModelWarn();
  }

  function missingKreaLora() {
    if (!isKreaEdit()) return null;
    const row = taskLoraRow();
    const name = (row && row.name) || KREA_TASKS[kreaTaskId()].file;
    if (findInstalledLora(name)) return null;
    const known = Object.values(KREA_TASKS).find((t) => basenameOf(t.file) === basenameOf(name));
    return { file: name, url: known ? known.url : "" };
  }

  function emptyWeightReasons() {
    const c = cfg();
    if ((c.loader || "diffusion") === "checkpoint") {
      return (c.checkpoint || "").trim() ? [] : ["Выберите чекпоинт"];
    }
    const out = [];
    if (!(c.unet || "").trim()) out.push("Выберите UNET");
    if (!(c.clip || "").trim()) out.push("Выберите CLIP");
    if (!(c.vae || "").trim()) out.push("Выберите VAE");
    return out;
  }

  function renderModelWarn() {
    const host = $("model-warn");
    if (!host) return;
    const spec = missingKreaLora();
    if (!spec) { host.innerHTML = ""; return; }
    host.innerHTML = `<div class="miss-card">
      <div class="miss-line lora">
        <span class="nm" title="${escapeHtml(spec.file)}">${escapeHtml(spec.file)}</span>
        <span class="dir">models/loras/</span>
        ${spec.url ? `<a class="dl" href="${escapeHtml(spec.url)}" target="_blank" rel="noopener">Скачать</a>` : ""}
      </div>
      <button type="button" class="b s" data-rescan="1">Проверить снова</button>
    </div>`;
  }

  function weightInstalled(kind, name) {
    if (kind === "loras") return !!findInstalledLora(name);
    return catalogHas((state.catalog || {})[kind], name);
  }

  function modelDownloadsHtml() {
    return MODEL_DOWNLOADS.map((group) => {
      const rows = group.files.map((file) => {
        const on = weightInstalled(file.kind, file.name);
        return `<div class="dl-row">
          <span class="nm" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
          <span class="dir">${escapeHtml(file.folder)}</span>
          <span class="st ${on ? "ok" : "no"}">${on ? "установлен" : "не установлен"}</span>
          <a href="${escapeHtml(file.url)}" target="_blank" rel="noopener">Скачать</a>
        </div>`;
      }).join("");
      const note = group.note ? `<div class="mu">${escapeHtml(group.note)}</div>` : "";
      return `<section class="dl-group"><h4>${escapeHtml(group.title)}</h4>${note}${rows}</section>`;
    }).join("");
  }

  async function rescanModels() {
    try {
      const [models, loras] = await Promise.all([
        api("/zeroimagestudio/models"),
        api("/zeroimagestudio/loras"),
      ]);
      state.catalog = models;
      state.loras = loras.files || [];
      syncKreaStack();
      renderFiles();
      renderKreaChrome();
      renderLoras();
      updateGenerateButton();
      toast("Список моделей обновлён.");
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  function generateBlockReason() {
    if (state.running) return "";
    const reasons = [];
    if (!(state.prompt || "").trim()) reasons.push("Промт пустой.");
    if (state.pipeline === "edit") {
      const scene = sceneOnCanvas();
      if (isKreaEdit() && kreaTaskId() === "identity") {
        if (!scene && !state.references.length) reasons.push("Для «Персонаж по референсу» нужен референс человека или сцена на холсте.");
        else if (scene && !state.references.length) reasons.push("Для «Персонаж по референсу» добавьте фото человека в Референсы.");
      } else if (!scene) reasons.push("В правке нет изображения. Откройте фото.");
    }
    reasons.push(...emptyWeightReasons());
    const lora = missingKreaLora();
    const taskRow = taskLoraRow();
    if (lora && (!taskRow || taskRow.enabled !== false)) reasons.push("Нет LoRA режима: " + lora.file);
    return reasons.join(" ");
  }

  function updateGenerateButton() {
    const btn = $("btn-gen");
    const wrap = $("gen-wrap");
    if (!btn) return;
    if (state.running) {
      btn.disabled = false;
      const tip = "Отменить генерацию";
      btn.title = tip;
      if (wrap) wrap.title = tip;
      return;
    }
    const reason = generateBlockReason();
    btn.disabled = !!reason;
    const tip = reason || "Сгенерировать (Ctrl+Enter)";
    btn.title = tip;
    if (wrap) wrap.title = tip;
  }

  function openModelDrawer() {
    const node = $("model-node");
    if (!node) return;
    node.classList.add("open");
    $("model-drawer").inert = false;
    $("model-toggle").setAttribute("aria-expanded", "true");
    try { localStorage.setItem("zeroimagestudio.modelDrawer", "open"); } catch (err) { /* private mode */ }
    node.scrollIntoView({ block: "nearest" });
  }

  function newCanvas(w, h) {
    if (editor.layers.length) editor.pushUndo(editor.fullSnapshot());
    editor.doc = { w, h };
    editor.resizeMask();
    editor.maskCtx.clearRect(0, 0, w, h);
    editor.touchMask();
    editor.layers = [];
    editor.active = 0;
    state.maskFocus = null;
    state.workMaskHidden = false;
    state.area.userPlaced = false;
    syncDefaultArea();
    editor.fit();
    state.dirty = true;
    renderLayers();
    renderInspector();
    renderPipe();
    paintStatus();
    editor.requestDraw();
    updateGenerateButton();
    toast(`Холст ${w} × ${h}.`);
  }

  function toggleHelp(force) {
    let pop = $("help-pop");
    if (!pop) {
      pop = document.createElement("div");
      pop.id = "help-pop";
      pop.className = "help-pop";
      pop.innerHTML = `<div class="row"><b>Клавиши</b><button type="button" class="b s" id="help-close" style="margin-left:auto" title="Закрыть">Закрыть</button></div>
        <div>V перемещение · M рамка · L лассо · T трансформ · C кадр</div>
        <div>B кисть · E ластик · I пипетка · Q маска · G область</div>
        <div>H рука · Z масштаб · Пробел+перетаскивание панорама</div>
        <div><kbd>[</kbd> <kbd>]</kbd> размер кисти · колесо — масштаб вокруг курсора</div>
        <div><kbd>Ctrl+0</kbd> вместить · <kbd>Ctrl+1</kbd> 100% · <kbd>Ctrl+Z</kbd> отмена · <kbd>Ctrl+Shift+Z</kbd> повтор</div>
        <div><kbd>Ctrl+S</kbd> сохранить · <kbd>Ctrl+N</kbd> новый проект · <kbd>Ctrl+Enter</kbd> генерировать · <kbd>?</kbd> эта шпаргалка</div>
        <div><kbd>Delete</kbd> очищает выбранную маску · <kbd>Ctrl+D</kbd> очищает маску</div>
        <div><kbd>Alt</kbd> меню · стрелки по пунктам · <kbd>Esc</kbd> закрыть меню</div>`;
      document.body.appendChild(pop);
      pop.querySelector("#help-close").onclick = () => { pop.hidden = true; };
    }
    pop.hidden = force === true ? false : !pop.hidden;
  }

  function renderLayers() {
    const host = $("layer-list");
    const node = $("layers-node");
    const quiet = replacesCanvas();
    if (node) node.classList.toggle("quiet", quiet);
    const note = $("layers-note");
    if (note) note.hidden = !quiet;
    const blend = $("layer-blend");
    if (blend && !blend.dataset.ready) {
      blend.innerHTML = BLENDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
      blend.dataset.ready = "1";
      blend.onchange = () => {
        const l = editor.activeLayer(); if (!l || l.locked) return;
        editor.pushUndo(editor.fullSnapshot());
        l.blend = blend.value;
        editor.requestDraw();
        renderLayers();
      };
      $("layer-opacity").onchange = () => {
        const l = editor.activeLayer(); if (!l || l.locked) return;
        editor.pushUndo(editor.fullSnapshot());
        const v = parseFloat(String($("layer-opacity").value).replace("%", ""));
        l.opacity = Math.min(1, Math.max(0, (v > 1 ? v / 100 : v)));
        editor.requestDraw();
        renderLayers();
      };
    }
    const cur = editor.activeLayer();
    if (cur && blend) {
      blend.value = cur.blend;
      blend.disabled = !!cur.locked;
      $("layer-opacity").value = Math.round(cur.opacity * 100) + "%";
      $("layer-opacity").disabled = !!cur.locked;
    } else if (blend) {
      blend.disabled = true;
      $("layer-opacity").disabled = true;
    }
    const showMask = U.workMaskRowVisible(editor.maskArea() > 0, state.tool, state.maskFocus);
    const maskPreview = showMask ? editor.workMaskPreview() : "";
    const maskRow = showMask ? `<div class="layer mask-row ${state.maskFocus === "work" ? "on" : ""}" data-mask-row="1">
        <button class="e ${state.workMaskHidden ? "off" : ""}" data-mask-eye="1" data-i="${state.workMaskHidden ? "eyeoff" : "eye"}" data-s="15" type="button" title="${state.workMaskHidden ? "Показать" : "Скрыть"}"></button>
        <div class="t mask-ico" title="Маска">${maskPreview ? `<img src="${maskPreview}" alt="">` : `<span data-i="mask" data-s="16"></span>`}</div>
        <div class="n"><b>Маска</b><small>${state.workMaskHidden ? "скрыта" : "кисть проявляет"}</small></div>
        <button class="e" data-mask-inv="1" data-i="invert" data-s="14" type="button" title="Инвертировать"></button>
        <button class="e" data-mask-clear="1" data-i="trash" data-s="14" type="button" title="Очистить"></button>
      </div>` : "";
    const rows = [...editor.layers].reverse().map((l) => {
      const idx = editor.layers.indexOf(l);
      const on = idx === editor.active && state.maskFocus !== "work";
      const blendName = (BLENDS.find((b) => b[0] === l.blend) || ["", l.blend])[1];
      const lid = escapeHtml(l.id);
      const maskOn = state.maskFocus && state.maskFocus.id === l.id;
      const maskBtn = l.mask ? `<button class="mt ${maskOn ? "on" : ""}" data-lmask="${lid}" type="button" title="Маска слоя">${l.maskThumb ? `<img src="${l.maskThumb}" alt="">` : ""}</button>` : "";
      return `<div class="layer ${on ? "on" : ""}" data-layer="${lid}">
        <button class="e ${l.visible ? "" : "off"}" data-eye="${lid}" data-i="${l.visible ? "eye" : "eyeoff"}" data-s="15" type="button" title="${l.visible ? "Скрыть слой" : "Показать слой"}"></button>
        <div class="t" title="Миниатюра">${l.thumb ? `<img src="${l.thumb}" alt="">` : ""}</div>
        ${maskBtn}
        <div class="n"><b title="Двойной щелчок — переименовать">${escapeHtml(l.name)}</b><small>${escapeHtml(blendName)} · ${Math.round(Number(l.opacity) * 100) || 0}%${l.locked ? " · замок" : ""}${l.visible ? "" : " · скрыт"}</small></div>
        <button data-lock="${lid}" data-i="lock" data-s="13" type="button" title="${l.locked ? "Разблокировать" : "Заблокировать"}" style="color:${l.locked ? "var(--ac)" : "var(--mu)"}"></button>
      </div>`;
    }).join("");
    host.innerHTML = maskRow + (rows || `<div class="empty">Нет слоёв. Загрузите изображение или сгенерируйте.</div>`);
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
    sealCollapsed(node);
  }

  let ppEditingId = null;

  function normalizePreset(p, i) {
    return {
      id: U.safeId(p.id || ("p" + Date.now().toString(36) + i), "p" + i),
      name: String(p.name || "Пресет"),
      category: U.presetCategory(p),
      text: String(p.text || ""),
      position: p.position === "after" ? "after" : "before",
      enabled: !!p.enabled,
      favorite: !!p.favorite,
      order: Number.isFinite(Number(p.order)) ? Number(p.order) : i,
    };
  }

  function orderedPresets() {
    return [...state.promptPresets].sort((a, b) => (a.order - b.order) || String(a.name).localeCompare(String(b.name), "ru"));
  }

  function activeOrdered() {
    return orderedPresets().filter((p) => p.enabled && p.text);
  }

  async function persistPreset(p) {
    try {
      const saved = await api("/zeroimagestudio/collection/prompt_presets", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
      });
      if (saved && saved.id) p.id = saved.id;
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  const PROMPT_MODE_KEY = "zeroimagestudio.promptMode";

  function fitPromptField() {
    const el = $("prompt");
    const node = $("prompt-node");
    if (!el || !node) return;
    if (node.dataset.prompt === "full") {
      el.style.height = "";
      el.style.overflowY = "";
      return;
    }
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 18;
    const pad = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
    const border = (parseFloat(cs.borderTopWidth) || 0) + (parseFloat(cs.borderBottomWidth) || 0);
    const min = Math.ceil(line * 2 + pad + border);
    const max = Math.ceil(line * 4 + pad + border);
    el.style.height = "0px";
    const need = el.scrollHeight + border;
    const next = Math.min(max, Math.max(min, need));
    el.style.height = next + "px";
    el.style.overflowY = need > max + 1 ? "auto" : "hidden";
  }

  function setPromptMode(mode, persist) {
    const node = $("prompt-node");
    if (!node) return;
    const full = mode === "full";
    node.dataset.prompt = full ? "full" : "compact";
    const btn = $("prompt-fold");
    const slot = $("prompt-fold-slot");
    if (btn) {
      btn.title = full ? "Свернуть промт" : "Развернуть: негатив, стили, LLM";
      btn.setAttribute("aria-expanded", full ? "true" : "false");
      if (full && slot) slot.appendChild(btn);
      else if (!full && $("prompt")) $("prompt").insertAdjacentElement("afterend", btn);
    }
    fitPromptField();
    if (persist) {
      try { localStorage.setItem(PROMPT_MODE_KEY, node.dataset.prompt); } catch (err) { /* private mode */ }
    }
    requestAnimationFrame(() => {
      renderChips();
      fitPromptField();
      if (editor) editor.resizeView();
    });
  }

  function renderChips() {
    const active = activeOrdered();
    const count = $("pp-count");
    if (count) count.textContent = String(active.length);
    const host = $("pp-chips");
    if (!host) { updateFinal(); return; }
    const node = $("prompt-node");
    const compact = !node || node.dataset.prompt !== "full";
    const slot = $("pp-compact");
    const bar = document.querySelector("#prompt-presets .pp-bar");
    if (compact && slot) {
      if (host.parentElement !== slot) slot.appendChild(host);
      slot.hidden = active.length === 0;
    } else if (bar && host.parentElement !== bar) {
      bar.appendChild(host);
      if (slot) slot.hidden = true;
    }
    host.replaceChildren();
    const make = (p) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "pp-chip";
      chip.dataset.ppOff = p.id;
      chip.title = "Убрать из активных";
      chip.innerHTML = `<span class="p">${p.position === "after" ? "ПОСЛЕ" : "ДО"}</span><span class="n">${escapeHtml(p.name)}</span><span class="x">×</span>`;
      return chip;
    };
    if (host.clientWidth < 24) {
      active.slice(0, 2).forEach((p) => host.appendChild(make(p)));
      if (active.length > 2) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "pp-more";
        more.dataset.ppOpen = "1";
        more.textContent = "+" + (active.length - 2);
        host.appendChild(more);
      }
    } else {
      let shown = 0;
      for (const p of active) {
        const chip = make(p);
        host.appendChild(chip);
        if (host.scrollWidth > host.clientWidth + 1) { chip.remove(); break; }
        shown += 1;
      }
      const rest = active.length - shown;
      if (rest > 0) {
        const more = document.createElement("button");
        more.type = "button";
        more.className = "pp-more";
        more.dataset.ppOpen = "1";
        more.textContent = "+" + rest;
        host.appendChild(more);
        while (shown > 0 && host.scrollWidth > host.clientWidth + 1) {
          const chips = host.querySelectorAll(".pp-chip");
          if (!chips.length) break;
          chips[chips.length - 1].remove();
          shown -= 1;
          more.textContent = "+" + (active.length - shown);
        }
      }
    }
    if (compact && slot) slot.hidden = !host.querySelector(".pp-chip, .pp-more");
    updateFinal();
    if (!$("pp-pop").hidden) renderPromptMenu();
  }

  function renderPromptMenu() {
    const host = $("pp-list");
    if (!host) return;
    const q = ($("pp-search") && $("pp-search").value || "").trim().toLowerCase();
    const groups = new Map();
    for (const p of orderedPresets()) {
      if (q && !(p.name + " " + p.category + " " + p.text).toLowerCase().includes(q)) continue;
      const cat = p.category || "Общее";
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push(p);
    }
    const active = activeOrdered();
    const indexOf = (id) => active.findIndex((p) => p.id === id);
    if (!groups.size) {
      host.innerHTML = `<div class="empty">${q ? "Ничего не найдено." : "Пока нет пресетов. Нажмите «Создать»."}</div>`;
      return;
    }
    host.innerHTML = [...groups.entries()].map(([cat, items]) => `
      <div class="pp-group"><div class="pp-cat">${escapeHtml(cat)}</div>
      ${items.map((p) => {
        const i = indexOf(p.id);
        return `<div class="pp-row">
          <input type="checkbox" data-pp-on="${escapeHtml(p.id)}" ${p.enabled ? "checked" : ""}>
          <button type="button" class="nm" data-pp-edit="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>
          <button type="button" class="b s" data-pp-pos="${escapeHtml(p.id)}">${p.position === "after" ? "ПОСЛЕ" : "ДО"}</button>
          <button type="button" class="b s" data-pp-up="${escapeHtml(p.id)}" ${i <= 0 ? "disabled" : ""} title="Раньше среди активных">↑</button>
          <button type="button" class="b s" data-pp-down="${escapeHtml(p.id)}" ${i < 0 || i === active.length - 1 ? "disabled" : ""} title="Позже среди активных">↓</button>
          <button type="button" class="b s" data-pp-dup="${escapeHtml(p.id)}">Дубль</button>
          <button type="button" class="b s" data-pp-del="${escapeHtml(p.id)}">Удалить</button>
        </div>`;
      }).join("")}
      </div>`).join("");
  }

  function placePromptPop() {
    const pop = $("pp-pop");
    const btn = $("pp-open");
    const r = btn.getBoundingClientRect();
    const width = Math.min(520, window.innerWidth - 16);
    let left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    pop.style.width = width + "px";
    pop.style.left = left + "px";
    const below = window.innerHeight - r.bottom - 10;
    const above = r.top - 10;
    if (below < 260 && above > below) {
      pop.style.top = "auto";
      pop.style.bottom = (window.innerHeight - r.top + 6) + "px";
      pop.style.maxHeight = Math.max(180, above - 8) + "px";
    } else {
      pop.style.bottom = "auto";
      pop.style.top = (r.bottom + 6) + "px";
      pop.style.maxHeight = Math.max(180, below - 8) + "px";
    }
  }

  function openPromptPop() {
    $("pp-pop").hidden = false;
    $("pp-open").setAttribute("aria-expanded", "true");
    placePromptPop();
    renderPromptMenu();
  }

  function closePromptPop() {
    $("pp-pop").hidden = true;
    $("pp-open").setAttribute("aria-expanded", "false");
    $("pp-form").hidden = true;
    ppEditingId = null;
  }

  function openPresetForm(p) {
    ppEditingId = p ? p.id : null;
    $("pp-form").hidden = false;
    $("pp-name").value = p ? p.name : "";
    $("pp-cat").value = p ? (p.category || "") : "";
    $("pp-text").value = p ? p.text : "";
    $("pp-pos").value = p && p.position === "after" ? "after" : "before";
    $("pp-name").focus();
  }

  function assembleLocal() {
    const start = [], end = [], before = [], after = [];
    for (const l of activeLoras()) {
      if (!l.enabled || l.trigger_mode === "off" || !l.trigger_mode) continue;
      const words = (l.triggers || []).filter((t) => t.enabled !== false && t.text).map((t) => t.text);
      if (!words.length) continue;
      (l.trigger_mode === "start" ? start : end).push(words.join(", "));
    }
    for (const p of orderedPresets()) {
      if (!p.enabled || !p.text) continue;
      (p.position === "after" ? after : before).push(p.text.trim());
    }
    return [...start, ...before, state.prompt.trim(), ...after, ...end].filter(Boolean).join(", ");
  }

  function updateFinal() {
    const text = assembleLocal();
    const bits = [];
    orderedPresets().filter((p) => p.enabled && p.position !== "after").forEach((p) => bits.push("[" + p.name + "]"));
    bits.push("промт");
    orderedPresets().filter((p) => p.enabled && p.position === "after").forEach((p) => bits.push("[" + p.name + "]"));
    $("prompt-final").textContent = "⤷ итог: " + bits.join(" + ") + " — пресеты применяются при генерации, в поле не вставляются";
    $("token-est").textContent = text.length + " симв.";
  }

  function renderPipe() {
    generationSize();
  }

  function renderPresetSelect() {
    const sel = $("preset-select");
    const cur = sel.value;
    sel.innerHTML = `<option value="">— без пресета —</option>` + state.presets.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    $("preset-count").textContent = String(state.presets.length + state.promptPresets.length);
  }

  function galleryInProject(it) {
    const pid = state.projectId || "";
    return !!pid && (it.meta.project_id || "") === pid;
  }

  function assetInProject(asset) {
    const pid = state.projectId || "";
    return !!pid && (asset.project_ids || []).includes(pid);
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return v + " Б";
    if (v < 1024 * 1024) return Math.round(v / 1024) + " КБ";
    return (v / 1024 / 1024).toFixed(1) + " МБ";
  }

  function formatWhen(ts) {
    const d = new Date((Number(ts) || 0) * 1000);
    if (!Number(ts)) return "";
    return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short" });
  }

  function renderGallery() {
    const host = $("gal");
    const scope = state.galleryScope === "project" ? "project" : "all";
    const kind = state.galleryKind === "assets" ? "assets" : "gens";
    const node = $("gallery-node");
    if (node) node.dataset.kind = kind;
    document.querySelectorAll("#gal-scope button").forEach((b) => b.classList.toggle("on", b.dataset.scope === scope));
    document.querySelectorAll("#gal-kind button").forEach((b) => b.classList.toggle("on", b.dataset.kind === kind));
    if (kind === "assets") {
      renderAssetGallery(host, scope);
      return;
    }
    const allReal = state.gallery.filter((it) => !it.example);
    const projectReal = allReal.filter(galleryInProject);
    let items = (scope === "project" ? projectReal : allReal).slice();
    const model = $("gal-model").value;
    const lora = $("gal-lora").value;
    if (model) items = items.filter((it) => (it.meta.model_label || it.meta.unet || "") === model);
    if (lora) items = items.filter((it) => (it.meta.loras || []).some((l) => l.name === lora));
    if ($("gal-sort").value === "old") items.reverse();
    const colors = { krea2_edit: "#ff7a1a", qwen_image_21: "#4aa8ff", create: "#b18cff" };
    const scopeNote = scope === "project"
      ? "Только кадры этого проекта."
      : "Общая галерея: все проекты.";
    if (!items.length) {
      if (scope === "all" && new URLSearchParams(location.search).get("demo") === "1" && !allReal.length) {
        const examples = ["portrait-copper.svg", "portrait-blond.svg", "portrait-blue.svg", "portrait.svg", "portrait-green.svg"];
        host.innerHTML = examples.map((s, i) => `<button type="button" class="g" data-example="1"><img src="assets/${s}" alt=""><s style="background:${["#ff7a1a","#b18cff","#4aa8ff","#7d8594","#3ddc97"][i]}"></s></button>`).join("");
        $("gal-legend").innerHTML = "<span>Демо-оформление (?demo=1), не генерации.</span>";
      } else if (scope === "project") {
        host.innerHTML = `<div class="empty-gal">В этом проекте ещё нет генераций. Общие кадры — во «Все».</div>`;
        $("gal-legend").innerHTML = `<span>${scopeNote}</span>`;
      } else {
        host.innerHTML = `<div class="empty-gal">Галерея пуста. После генерации здесь будут ваши кадры с промтом и сидом.</div>`;
        $("gal-legend").innerHTML = `<span>${scopeNote}</span>`;
      }
    } else {
      host.innerHTML = items.map((it) => {
        const m = it.meta || {};
        const col = colors[m.edit_method] || colors[m.pipeline] || "#7d8594";
        const id = escapeHtml(it.id);
        const tip = [m.model_label || m.unet || m.checkpoint || "Генерация", m.width && m.height ? m.width + "×" + m.height : "", m.seed != null ? "seed " + m.seed : ""].filter(Boolean).join(" · ");
        const file = U.fileBase(it.file);
        return `<div class="g" role="button" tabindex="0" data-gal="${id}" title="${escapeHtml(tip)}"><img src="/view?filename=${encodeURIComponent(file)}&type=output&subfolder=zeroimagestudio/gallery" alt=""><s style="background:${col}"></s><span class="tile-actions"><button type="button" data-gal-apply="${id}" data-i="undo" data-s="13" title="Применить заново"></button><button type="button" data-gal-seed="${id}" data-i="dice" data-s="13" title="Взять сид"></button><button type="button" data-gal-lora="${id}" data-i="layers" data-s="13" title="Взять LoRA"></button></span></div>`;
      }).join("");
      if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
      $("gal-legend").innerHTML = `<span>${scopeNote}</span><span><b style="color:#ff7a1a">▬</b> Krea Edit</span><span><b style="color:#b18cff">▬</b> Создание</span><span><b style="color:#4aa8ff">▬</b> Qwen</span>`;
    }
    $("gal-count").textContent = String(scope === "project" ? projectReal.length : allReal.length);
    const pool = scope === "project" ? projectReal : allReal;
    const models = [...new Set(pool.map((it) => it.meta.model_label || it.meta.unet).filter(Boolean))];
    const loras = [...new Set(pool.flatMap((it) => (it.meta.loras || []).map((l) => l.name)))];
    fillSelect($("gal-model"), ["", ...models], model, "Модель");
    fillSelect($("gal-lora"), ["", ...loras], lora, "LoRA");
    const sort = $("gal-sort");
    if (sort) sort.title = sort.value === "old" ? "Сначала старые" : "Сначала новые";
    const label = $("gal-sort-label");
    if (label && sort) label.textContent = "сортировка: " + (sort.value === "old" ? "старые" : "новые");
    const more = $("gal-more");
    if (more) {
      const loaded = (state.gallery || []).filter((it) => !it.example).length;
      const total = Number(state.galleryTotal) || loaded;
      more.hidden = kind === "assets" || loaded >= total;
      more.textContent = "Ещё " + loaded + " / " + total;
    }
    sealCollapsed($("gallery-node"));
  }

  function assetMeta(asset) {
    return [`${asset.width || "?"}×${asset.height || "?"}`, formatBytes(asset.bytes), formatWhen(asset.created)].filter(Boolean).join(" · ");
  }

  function renderAssetGallery(host, scope) {
    const all = state.assets || [];
    const items = (scope === "project" ? all.filter(assetInProject) : all.slice())
      .sort((a, b) => (b.created || 0) - (a.created || 0));
    const note = scope === "project" ? "Только ассеты этого проекта." : "Все загруженные изображения.";
    if (!items.length) {
      host.innerHTML = `<div class="empty-gal">${scope === "project" ? "В этом проекте ещё нет ассетов." : "Ассетов пока нет. Сюда попадают импорт на холст и референсы."}</div>`;
    } else {
      host.innerHTML = items.map((asset) => {
        const id = escapeHtml(asset.id);
        const meta = assetMeta(asset);
        const name = asset.name || "Изображение";
        const badges = (asset.roles || []).map((role) => {
          const ref = role === "reference";
          return `<span class="asset-badge${ref ? " ref" : ""}" title="${ref ? "Референс" : "Холст"}">${ref ? "Реф" : "Холст"}</span>`;
        }).join("");
        return `<div class="g asset-tile" draggable="true" data-asset="${id}" title="${escapeHtml(name + " · " + meta)}">
          <img src="/zeroimagestudio/assets/${encodeURIComponent(asset.id)}/thumb" alt="">
          <span class="asset-badges">${badges}</span>
          <span class="tile-actions">
            <button type="button" data-asset-open="${id}" data-i="open" data-s="13" title="Открыть на холсте"></button>
            <button type="button" data-asset-ref="${id}" data-i="image" data-s="13" title="Добавить как референс"></button>
            <button type="button" data-asset-del="${id}" data-i="trash" data-s="13" title="Удалить"></button>
          </span>
        </div>`;
      }).join("");
      if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
    }
    $("gal-legend").innerHTML = `<span>${note}</span>`;
    $("gal-count").textContent = String(items.length);
    const label = $("gal-sort-label");
    if (label) label.textContent = "ассеты";
    sealCollapsed($("gallery-node"));
  }

  function openAssetMenu(x, y, id) {
    let menu = $("asset-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "asset-menu";
      menu.className = "layer-menu";
      menu.hidden = true;
      document.body.appendChild(menu);
      menu.addEventListener("click", async (ev) => {
        const btn = ev.target.closest("[data-asset-open], [data-asset-ref], [data-asset-del]");
        if (!btn) return;
        ev.stopPropagation();
        menu.hidden = true;
        const assetId = btn.dataset.assetOpen || btn.dataset.assetRef || btn.dataset.assetDel;
        try {
          if (btn.dataset.assetOpen) await openAssetOnCanvas(assetId);
          else if (btn.dataset.assetRef) await addAssetAsReference(assetId);
          else await deleteAsset(assetId);
        } catch (err) { toast(err.message || String(err)); }
      });
    }
    menu.innerHTML = `<button type="button" data-asset-open="${escapeHtml(id)}">Открыть на холсте</button>
      <button type="button" data-asset-ref="${escapeHtml(id)}">Добавить как референс</button>
      <button type="button" data-asset-del="${escapeHtml(id)}">Удалить</button>`;
    menu.hidden = false;
    const rect = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
    const close = (ev) => {
      if (ev && menu.contains(ev.target)) return;
      menu.hidden = true;
      document.removeEventListener("mousedown", close);
    };
    setTimeout(() => document.addEventListener("mousedown", close), 0);
  }

  function fillSelect(sel, values, current, placeholder) {
    const prev = current;
    sel.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v || placeholder)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function escapeHtml(s) {
    return U.escapeHtml(s);
  }

  function usesSource() {
    if (state.pipeline === "edit") return true;
    if (editor && editor.maskArea() > 8) return true;
    if (state.sampler.denoise < 0.999 && editor && editor.layers.some((l) => l.visible)) return true;
    return false;
  }

  function specFromState() {
    const c = cfg();
    const s = state.sampler;
    return {
      pipeline: state.pipeline,
      loader: c.loader,
      checkpoint: c.checkpoint,
      unet: c.unet,
      clip: c.clip,
      vae: c.vae,
      clip_type: c.clip_type,
      weight_dtype: c.weight_dtype,
      latent_mode: c.latent_mode,
      encoder: c.encoder,
      edit_method: c.method,
      inpaint_mode: c.inpaint_mode,
      inpaint_grow: U.finiteNumber(c.inpaint_grow, 6),
      qwen_resolution: U.finiteNumber(c.qwen_resolution, 0),
      krea: { ...(c.krea || {}) },
      loras: c.loras,
      prompt: state.prompt,
      negative: state.negative,
      prompt_presets: orderedPresets(),
      seed: s.seed,
      steps: s.steps,
      cfg: s.cfg,
      denoise: s.denoise,
      sampler: s.sampler,
      scheduler: s.scheduler,
      batch: s.batch,
      width: generationSize().w,
      height: generationSize().h,
      filename_prefix: "zeroimagestudio/gen",
    };
  }

  function nextSeed() {
    if (state.sampler.seedMode === "random") state.sampler.seed = Math.floor(Math.random() * 1e9);
    else if (state.sampler.seedMode === "increment") state.sampler.seed = (Number(state.sampler.seed) + 1) >>> 0;
    const el = $("seed");
    if (el) el.value = state.sampler.seed;
  }

  function fitRegionCanvas(src, boxW, boxH) {
    const frame = window.ZeroImageStudioSize.frameForRegion(src.width, src.height, boxW, boxH);
    const placed = window.ZeroImageStudioSize.containRect(src.width, src.height, frame.w, frame.h);
    const canvas = document.createElement("canvas");
    canvas.width = frame.w;
    canvas.height = frame.h;
    const g = canvas.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, frame.w, frame.h);
    g.drawImage(src, placed.x, placed.y, placed.w, placed.h);
    return { canvas, frame, placed };
  }

  function jobName(kind, index) {
    const id = U.safeId(state.jobId, "job");
    const tail = index == null ? kind : kind + "-" + index;
    return "zis-" + id + "-" + tail + ".png";
  }

  function cropFrameContent(img, fit, outW, outH) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, outW);
    canvas.height = Math.max(1, outH);
    const sx = fit.placed.x * (img.width / fit.frame.w);
    const sy = fit.placed.y * (img.height / fit.frame.h);
    const sw = Math.max(1, fit.placed.w * (img.width / fit.frame.w));
    const sh = Math.max(1, fit.placed.h * (img.height / fit.frame.h));
    canvas.getContext("2d").drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  function keepGrounding(spec) {
    if (Number.isFinite(Number(spec.krea && spec.krea.grounding_px))) spec.krea.grounding_px = Number(spec.krea.grounding_px);
    else if (spec.krea) delete spec.krea.grounding_px;
  }

  async function uploadCanvas(canvas, name) {
    const blob = await canvasBlob(canvas);
    const fd = new FormData();
    fd.append("image", blob, name);
    fd.append("overwrite", "true");
    fd.append("type", "input");
    fd.append("subfolder", "zeroimagestudio");
    const res = await fetch("/upload/image", { method: "POST", body: fd });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Не удалось загрузить изображение в ComfyUI");
    return data.subfolder ? data.subfolder + "/" + data.name : data.name;
  }

  function imageCanvas(img) {
    const c = document.createElement("canvas");
    c.width = img.width; c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    return c;
  }

  function scaleCanvas(src, w, h) {
    const c = document.createElement("canvas");
    c.width = Math.max(64, w);
    c.height = Math.max(64, h);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = true;
    g.imageSmoothingQuality = "high";
    g.drawImage(src, 0, 0, c.width, c.height);
    return c;
  }

  function connectWs() {
    if (location.protocol === "file:") return;
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?clientId=${clientId}`);
    ws.binaryType = "arraybuffer";
    ws.addEventListener("message", (ev) => {
      if (state.studioPaused && !state.running) return;
      if (ev.data instanceof ArrayBuffer) { showBinaryPreview(ev.data); return; }
      if (!wsWait) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      wsWait(msg);
    });
    ws.addEventListener("close", () => setTimeout(connectWs, 1500));
  }

  function showBinaryPreview(buf) {
    if (!state.running || buf.byteLength < 8) return;
    const view = new DataView(buf);
    const event = view.getUint32(0);
    let bytes = null;
    let mime = "image/jpeg";
    if (event === 1) {
      const kind = view.getUint32(4);
      mime = kind === 2 ? "image/png" : "image/jpeg";
      bytes = buf.slice(8);
    } else if (event === 4) {
      const metaLen = view.getUint32(4);
      const start = 8 + metaLen;
      if (start >= buf.byteLength) return;
      try {
        const meta = JSON.parse(new TextDecoder().decode(new Uint8Array(buf.slice(8, start))));
        if (meta && meta.image_type) mime = meta.image_type;
      } catch { /* ignore */ }
      bytes = buf.slice(start);
    }
    if (!bytes) return;
    const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
    const img = $("ga-preview");
    if (!img) return;
    const prev = img.src;
    img.src = url;
    img.hidden = false;
    if (prev && prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  }

  function queuePromptId(item) {
    if (Array.isArray(item)) return item[1];
    return item && (item.prompt_id || item.id);
  }

  async function stopOurPrompt() {
    const id = state.promptId;
    let queue = {};
    try { queue = await api("/queue"); } catch { queue = {}; }
    const running = (queue.queue_running || []).some((item) => queuePromptId(item) === id);
    const pending = (queue.queue_pending || []).some((item) => queuePromptId(item) === id);
    if (running) await fetch("/interrupt", { method: "POST" });
    else if (pending && id) {
      await api("/queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ delete: [id] }) });
    }
  }

  function waitPrompt(promptId) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(poll);
        wsWait = null;
        if (err) reject(err);
        else resolve();
      };
      const timer = setTimeout(() => finish(new Error("Таймаут ожидания ComfyUI")), 30 * 60 * 1000);
      const poll = setInterval(async () => {
        if (!ws || ws.readyState !== WebSocket.OPEN) connectWs();
        try {
          const hist = await api("/history/" + encodeURIComponent(promptId));
          const entry = hist && hist[promptId];
          if (!entry) return;
          const status = entry.status || {};
          if (status.status_str === "error") finish(new Error(status.exception_message || "Ошибка выполнения"));
          else if (entry.outputs || status.completed) finish();
        } catch { /* the socket may still deliver the result */ }
      }, 4000);
      if (!ws || ws.readyState !== WebSocket.OPEN) connectWs();
      wsWait = (msg) => {
        const d = msg.data || {};
        if (d.prompt_id && d.prompt_id !== promptId) return;
        if (msg.type === "progress") {
          const pct = d.max ? Math.round(100 * d.value / d.max) : 0;
          $("gen-progress").style.display = "block";
          $("gen-progress").firstElementChild.style.width = pct + "%";
          const label = `Шаг ${d.value}/${d.max}`;
          $("gen-label").textContent = label;
          const run = $("ga-run-label");
          if (run) run.textContent = label;
        }
        if (msg.type === "executing" && d.node) {
          $("gen-label").textContent = "Узел " + d.node;
          const run = $("ga-run-label");
          if (run) run.textContent = "Узел " + d.node;
        }
        if (msg.type === "execution_interrupted") finish(new Error("Генерация остановлена"));
        if (msg.type === "execution_error") finish(new Error(d.exception_message || "Ошибка выполнения"));
        if (msg.type === "execution_success" || (msg.type === "executing" && d.node == null && d.prompt_id === promptId)) finish();
      };
    });
  }

  async function generate() {
    if (state.running) { await stopOurPrompt(); return; }
    const blocked = generateBlockReason();
    if (blocked) {
      const needsModel = emptyWeightReasons().length || missingKreaLora();
      toast(blocked, { openModels: !!needsModel });
      if (needsModel) openModelDrawer();
      return;
    }
      state.jobId = (crypto.randomUUID && crypto.randomUUID().replace(/-/g, "").slice(0, 12)) || String(Date.now());
      state.running = true;
    $("btn-gen").classList.add("stop");
    $("gen-label").textContent = "Отмена";
    $("gen-progress").style.display = "block";
    $("gen-progress").firstElementChild.style.width = "0%";
    const runLabel = $("ga-run-label");
    if (runLabel) runLabel.textContent = "В очереди";
    const preview = $("ga-preview");
    if (preview) { preview.removeAttribute("src"); preview.hidden = true; }
    updateGenerateButton();
    editor.requestDraw();
    try {
      syncDefaultArea();
      nextSeed();
      const spec = specFromState();
      spec.krea = { ...(cfg().krea || {}) };
      const kreaOn = isKreaEdit();
      const task = kreaOn ? kreaTaskId() : "";
      const scene = sceneOnCanvas();
      let crop = null;
      let regionFit = null;
      if (kreaOn && task === "identity" && !scene) {
        const person = state.references[0];
        const budget = generationSize();
        const fitted = fitRegionCanvas(person.canvas, budget.w, budget.h);
        spec.width = fitted.frame.w;
        spec.height = fitted.frame.h;
        spec.image = await uploadCanvas(fitted.canvas, jobName("ref", 0));
        spec.references = [];
        spec.has_mask = false;
        spec.krea.task = "identity";
        spec.krea.ref_position = "aligned (trained)";
        spec.krea.ref_position_a = "aligned (trained)";
        keepGrounding(spec);
      } else {
        const source = usesSource();
        const expand = source && state.pipeline === "edit" ? state.area.context : (editor.maskArea() > 8 ? state.area.context : 0);
        crop = source ? editor.cropOf(expand) : null;
        spec.has_mask = !!(crop && editor.maskArea() > 8);
        if (crop) {
          regionFit = fitRegionCanvas(crop.canvas, spec.width, spec.height);
          const maskFit = fitRegionCanvas(crop.mask, spec.width, spec.height);
          spec.width = regionFit.frame.w;
          spec.height = regionFit.frame.h;
          spec.image = await uploadCanvas(regionFit.canvas, jobName("crop"));
          if (spec.has_mask || state.pipeline === "edit") spec.mask = await uploadCanvas(maskFit.canvas, jobName("mask"));
        }
        const refs = [];
        if (state.pipeline === "edit" && !(kreaOn && task === "general")) {
          const list = kreaOn && task === "identity" ? state.references.slice(0, 1) : state.references;
          for (let i = 0; i < list.length; i++) refs.push(await uploadCanvas(list[i].canvas, jobName("ref", i)));
        }
        spec.references = refs;
        if (kreaOn && task === "general") {
          spec.krea.task = "general";
          spec.krea.ref_position = "aligned (trained)";
          spec.krea.ref_position_a = "aligned (trained)";
          keepGrounding(spec);
        } else if (kreaOn && task === "identity") {
          spec.krea.task = "identity";
          spec.krea.ref_position = "beside (right of target)";
          spec.krea.ref_position_a = "aligned (trained)";
          keepGrounding(spec);
        }
      }
      const built = await api("/zeroimagestudio/build_workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
      if (built.warnings && built.warnings.length) toast(built.warnings[0]);
      const queued = await api("/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: built.workflow, client_id: clientId }) });
      if (queued.node_errors && Object.keys(queued.node_errors).length) {
        const first = Object.values(queued.node_errors)[0];
        throw new Error((first.errors && first.errors[0] && first.errors[0].message) || "Граф отклонён ComfyUI");
      }
      state.promptId = queued.prompt_id;
      $("gen-label").textContent = "Считаем…";
      await waitPrompt(queued.prompt_id);
      const hist = await api("/history/" + queued.prompt_id);
      const entry = hist[queued.prompt_id];
      const images = [];
      Object.values((entry && entry.outputs) || {}).forEach((out) => (out.images || []).forEach((img) => images.push(img)));
      if (!images.length) throw new Error("ComfyUI не вернул изображение.");
      const urls = images.map((img) => `/view?filename=${encodeURIComponent(img.filename)}&type=${encodeURIComponent(img.type || "output")}&subfolder=${encodeURIComponent(img.subfolder || "")}`);
      const pick = await chooseVariant(urls);
      const blob = await (await fetch(urls[pick])).blob();
      const meta = generationMeta(spec, built.final_prompt);
      await rememberGallery(blob, meta);
      let pasted = blob;
      if (crop && regionFit) {
        const framed = await loadImage(URL.createObjectURL(blob));
        pasted = await canvasBlob(cropFrameContent(framed, regionFit, crop.canvas.width, crop.canvas.height));
      }
      if (crop) {
        try {
          const fd = new FormData();
          fd.append("result", pasted, "result.png");
          fd.append("original", await canvasBlob(crop.canvas), "original.png");
          fd.append("mask", await canvasBlob(crop.mask), "mask.png");
          fd.append("mode", state.area.paste);
          fd.append("feather", String(state.area.feather));
          fd.append("color_match", state.area.colorMatch ? "1" : "0");
          const res = await fetch("/zeroimagestudio/paste", { method: "POST", body: fd });
          if (!res.ok) throw new Error(await res.text());
          pasted = await res.blob();
        } catch (err) {
          toast("Poisson на сервере не вышел, вклейка растушёвкой. " + err.message);
          pasted = await localFeather(pasted, crop);
        }
      }
      const img = await loadImage(URL.createObjectURL(pasted));
      const snap = editor.fullSnapshot();
      const replace = replacesCanvas();
      const usedMask = !!(crop && spec.has_mask);
      let placed = null;
      if (replace) {
        const canvas = crop ? imageCanvas(img) : scaleCanvas(img, editor.doc.w, editor.doc.h);
        const layer = editor.makeLayer("Холст", canvas);
        layer.x = 0; layer.y = 0; layer.meta = meta;
        editor.layers = [layer];
        editor.active = 0;
        placed = layer;
        toast("Готово, холст заменён. Сид " + spec.seed + ". Прошлый кадр в отмене и в галерее.");
      } else {
        const n = editor.layers.filter((l) => l.name.startsWith(state.pipeline === "edit" ? "Правка" : "Генерация")).length + 1;
        const label = state.pipeline === "edit" ? ("Правка " + n) : ("Генерация " + n);
        if (!crop) {
          const layerCanvas = scaleCanvas(img, editor.gen.w, editor.gen.h);
          const layer = editor.makeLayer(label, layerCanvas);
          layer.x = editor.gen.x; layer.y = editor.gen.y; layer.meta = meta;
          editor.addLayer(layer);
          placed = layer;
        } else {
          const c = imageCanvas(img);
          const layer = editor.makeLayer(label, c);
          layer.x = crop.x; layer.y = crop.y; layer.meta = meta;
          editor.addLayer(layer);
          placed = layer;
        }
        toast("Готово, новый слой. Сид " + spec.seed + ".");
      }
      if (usedMask && placed && !replace) editor.attachLayerMask(placed, crop.mask, state.area.feather);
      if (usedMask) editor.consumeWorkMask();
      if (placed) editor.thumb(placed);
      editor.pushUndo(snap);
      renderLayers();
    } catch (err) {
      const msg = err.message || String(err);
      const missing = /не выбран/i.test(msg);
      toast(msg, { openModels: missing });
      if (missing) openModelDrawer();
    } finally {
      state.running = false;
      state.promptId = null;
      $("btn-gen").classList.remove("stop");
      $("gen-label").textContent = "Сгенерировать";
      $("gen-progress").style.display = "none";
      updateGenerateButton();
      editor.requestDraw();
      renderGallery();
    }
  }

  function generationMeta(spec, finalPrompt) {
    const c = cfg();
    return {
      prompt: state.prompt,
      final_prompt: finalPrompt || assembleLocal(),
      negative: state.negative,
      seed: spec.seed, steps: spec.steps, cfg: spec.cfg, denoise: spec.denoise,
      sampler: spec.sampler, scheduler: spec.scheduler,
      pipeline: state.pipeline, edit_method: c.method, encoder: c.encoder,
      model_label: (state.hints.find((h) => h.id === state.hintId) || {}).name || "",
      loader: c.loader, unet: c.unet, clip: c.clip, vae: c.vae, checkpoint: c.checkpoint, clip_type: c.clip_type,
      loras: (c.loras || []).filter((l) => l.enabled).map((l) => ({ name: l.name, strength_model: l.strength_model, strength_clip: l.strength_clip })),
      width: spec.width, height: spec.height,
      project_id: state.projectId || "",
      created: Math.floor(Date.now() / 1000),
    };
  }

  async function rememberGallery(blob, meta) {
    const fd = new FormData();
    fd.append("image", blob, "gen.png");
    fd.append("meta", JSON.stringify(meta));
    const saved = await api("/zeroimagestudio/gallery", { method: "POST", body: fd });
    state.gallery.unshift({ id: saved.id, file: saved.file, meta: saved.meta });
    state.galleryTotal = (Number(state.galleryTotal) || 0) + 1;
  }

  async function localFeather(blob, crop) {
    const img = await loadImage(URL.createObjectURL(blob));
    const w = crop.canvas.width, h = crop.canvas.height;
    const out = document.createElement("canvas");
    out.width = w; out.height = h;
    const ctx = out.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    const m = document.createElement("canvas");
    m.width = w; m.height = h;
    const mg = m.getContext("2d");
    mg.filter = `blur(${Math.max(0, state.area.feather / 2)}px)`;
    mg.drawImage(crop.mask, 0, 0, w, h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(m, 0, 0);
    return canvasBlob(out);
  }

  function chooseVariant(urls) {
    if (urls.length <= 1) return Promise.resolve(0);
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "modal-back";
      back.innerHTML = `<div class="modal"><h3>Выберите вариант</h3><div class="gal" style="grid-template-columns:repeat(${Math.min(4, urls.length)},1fr)">${urls.map((u, i) => `<button class="g" data-i="${i}"><img src="${escapeHtml(u)}" alt=""></button>`).join("")}</div></div>`;
      back.addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (!b) return;
        back.remove();
        resolve(Number(b.dataset.i));
      });
      document.body.appendChild(back);
    });
  }

  function duplicateActive() {
    const l = editor.activeLayer(); if (!l) return;
    editor.pushUndo(editor.fullSnapshot());
    const c = document.createElement("canvas");
    c.width = l.canvas.width; c.height = l.canvas.height;
    c.getContext("2d").drawImage(l.canvas, 0, 0);
    const copy = editor.makeLayer(l.name + " копия", c);
    copy.x = l.x + 16; copy.y = l.y + 16; copy.blend = l.blend; copy.opacity = l.opacity;
    editor.copyMask(l, copy);
    editor.addLayer(copy);
  }

  function mergeDown() {
    const i = editor.active;
    if (i <= 0) { toast("Ниже нет слоя."); return; }
    const upper = editor.layers[i];
    const lower = editor.layers[i - 1];
    if (!upper || !lower || lower.locked) { toast(lower && lower.locked ? "Нижний слой заблокирован." : "Ниже нет слоя."); return; }
    editor.pushUndo(editor.fullSnapshot());
    lower.ctx.save();
    lower.ctx.setTransform(1, 0, 0, 1, 0, 0);
    lower.ctx.globalAlpha = upper.opacity;
    lower.ctx.globalCompositeOperation = !upper.blend || upper.blend === "normal" ? "source-over" : upper.blend;
    lower.ctx.translate(upper.x - lower.x, upper.y - lower.y);
    lower.ctx.rotate(upper.rotation || 0);
    lower.ctx.scale(upper.scaleX || 1, upper.scaleY || 1);
    lower.ctx.drawImage(editor.composited(upper), 0, 0);
    lower.ctx.restore();
    editor.layers.splice(i, 1);
    editor.active = i - 1;
    editor.thumb(lower);
    editor.requestDraw();
    renderLayers();
  }

  function maskFromLayer() {
    const layer = editor.activeLayer();
    if (!layer) return;
    editor.pushUndo(editor.fullSnapshot());
    const tmp = document.createElement("canvas");
    tmp.width = layer.canvas.width; tmp.height = layer.canvas.height;
    const g = tmp.getContext("2d");
    g.drawImage(layer.canvas, 0, 0);
    const data = g.getImageData(0, 0, tmp.width, tmp.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const a = data.data[i + 3];
      data.data[i] = data.data[i + 1] = data.data[i + 2] = a;
      data.data[i + 3] = 255;
    }
    g.putImageData(data, 0, 0);
    editor.maskCtx.clearRect(0, 0, editor.doc.w, editor.doc.h);
    editor.maskCtx.drawImage(tmp, layer.x, layer.y);
    editor.touchMask();
    state.maskFocus = "work";
    editor.requestDraw();
    renderLayers();
    renderInspector();
    toast("Маска взята из непрозрачности слоя.");
  }

  function layerMenuEl() {
    let menu = $("layer-menu");
    if (!menu) {
      menu = document.createElement("div");
      menu.id = "layer-menu";
      menu.className = "layer-menu";
      document.body.appendChild(menu);
      document.addEventListener("pointerdown", (e) => {
        if (menu.hidden || menu.contains(e.target)) return;
        menu.hidden = true;
      });
    }
    return menu;
  }

  function placeLayerMenu(menu, x, y) {
    menu.hidden = false;
    menu.style.left = Math.min(x, window.innerWidth - 220) + "px";
    menu.style.top = Math.min(y, window.innerHeight - 240) + "px";
  }

  function openLayerMenu(x, y) {
    const menu = layerMenuEl();
    const layer = editor.activeLayer();
    const maskActs = layer && layer.mask ? `
      <button type="button" data-act="delmask">Удалить маску</button>
      <button type="button" data-act="applymask">Применить маску</button>` : "";
    menu.innerHTML = `
      <button type="button" data-act="dup">Дублировать</button>
      <button type="button" data-act="merge">Объединить с нижним</button>
      <button type="button" data-act="mask">Маска из слоя</button>
      <button type="button" data-act="fit-canvas">Холст по слою</button>
      ${maskActs}
      <button type="button" data-act="del">Удалить</button>`;
    placeLayerMenu(menu, x, y);
    menu.onclick = (e) => {
      const act = e.target.closest("[data-act]");
      menu.hidden = true;
      if (!act) return;
      if (act.dataset.act === "dup") duplicateActive();
      if (act.dataset.act === "merge") mergeDown();
      if (act.dataset.act === "mask") maskFromLayer();
      if (act.dataset.act === "fit-canvas") fitCanvasToContent("layer");
      if (act.dataset.act === "delmask") editor.deleteLayerMask();
      if (act.dataset.act === "applymask") editor.applyLayerMask();
      if (act.dataset.act === "del") editor.deleteActive();
    };
  }

  function openWorkMaskMenu(x, y) {
    const menu = layerMenuEl();
    menu.innerHTML = `
      <button type="button" data-act="dup">Дублировать</button>
      <button type="button" data-act="inv">Инвертировать</button>
      <button type="button" data-act="eye">${state.workMaskHidden ? "Показать" : "Скрыть"}</button>
      <button type="button" data-act="clear">Очистить</button>
      <button type="button" data-act="del">Удалить</button>`;
    placeLayerMenu(menu, x, y);
    menu.onclick = (e) => {
      const act = e.target.closest("[data-act]");
      menu.hidden = true;
      if (!act) return;
      if (act.dataset.act === "dup") duplicateWorkMask();
      if (act.dataset.act === "inv") editor.invertWorkMask();
      if (act.dataset.act === "eye") editor.toggleWorkMask();
      if (act.dataset.act === "clear" || act.dataset.act === "del") editor.clearWorkMask();
    };
  }

  function duplicateWorkMask() {
    editor.pushUndo(editor.fullSnapshot());
    const src = editor.exportMask();
    const layer = editor.makeLayer("Маска");
    layer.canvas.width = editor.doc.w;
    layer.canvas.height = editor.doc.h;
    const g = layer.ctx;
    g.drawImage(src, 0, 0);
    const data = g.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
    for (let i = 0; i < data.data.length; i += 4) {
      const lum = Math.max(data.data[i], data.data[i + 1], data.data[i + 2]);
      data.data[i] = data.data[i + 1] = data.data[i + 2] = 255;
      data.data[i + 3] = lum;
    }
    g.putImageData(data, 0, 0);
    editor.addLayer(layer);
    state.maskFocus = null;
    editor.requestDraw();
    renderLayers();
  }

  async function saveProject(opts) {
    const meta = editor.exportMeta();
    meta.state = {
      projectName: state.projectName, pipeline: state.pipeline, hintId: state.hintId,
      prompt: state.prompt, negative: state.negative, promptPresets: state.promptPresets,
      sampler: state.sampler, create: state.create, edit: state.edit, area: state.area, color: state.color, brush: state.brush,
      maskFocus: state.maskFocus, workMaskHidden: !!state.workMaskHidden,
      kreaTaskSlots: state.kreaTaskSlots,
    };
    const fd = new FormData();
    fd.append("meta", JSON.stringify(meta));
    fd.append("mask.png", await canvasBlob(editor.maskCanvas), "mask.png");
    for (const layer of editor.layers) {
      fd.append("layers/" + layer.id + ".png", await canvasBlob(layer.canvas), layer.id + ".png");
      if (layer.mask) fd.append("layers/" + layer.id + ".mask.png", await canvasBlob(layer.mask.canvas), layer.id + ".mask.png");
    }
    for (const ref of state.references) fd.append("refs/" + ref.id + ".png", await canvasBlob(ref.canvas), ref.id + ".png");
    const path = state.projectId ? "/zeroimagestudio/project/" + state.projectId : "/zeroimagestudio/project";
    const saved = await api(path, { method: "POST", body: fd });
    state.projectId = saved.id;
    state.dirty = false;
    $("project-sub").textContent = (opts && opts.auto ? "автосохранение " : "сохранено ") + new Date().toLocaleTimeString();
    rememberProject(saved.id, state.projectName);
    return saved.id;
  }

  function projectFileUrl(projectId, file) {
    const parts = U.normalizeSlashes(String(file || "")).split("/").filter(Boolean).map((part) => encodeURIComponent(part));
    return "/zeroimagestudio/project/" + encodeURIComponent(projectId) + "/file/" + parts.join("/");
  }

  function sanitizeLoadedState() {
    state.projectName = String(state.projectName || "Проект").slice(0, 200);
    state.prompt = String(state.prompt ?? "");
    state.negative = String(state.negative ?? "");
    const sampler = state.sampler || {};
    sampler.seed = U.finiteNumber(sampler.seed, 0);
    sampler.steps = U.finiteNumber(sampler.steps, 20);
    sampler.cfg = U.finiteNumber(sampler.cfg, 7);
    sampler.denoise = U.finiteNumber(sampler.denoise, 1);
    sampler.batch = U.finiteNumber(sampler.batch, 1);
    state.sampler = sampler;
    for (const key of ["create", "edit"]) {
      const pipe = state[key];
      if (!pipe || typeof pipe !== "object") continue;
      if (pipe.krea && typeof pipe.krea === "object") {
        const fallback = pipe.krea.task === "identity" ? 1024 : 768;
        if (pipe.krea.grounding_px != null && pipe.krea.grounding_px !== "") pipe.krea.grounding_px = U.finiteNumber(pipe.krea.grounding_px, fallback);
      }
      if (pipe.qwen_resolution != null && pipe.qwen_resolution !== "") pipe.qwen_resolution = U.finiteNumber(pipe.qwen_resolution, 0);
      if (pipe.inpaint_grow != null && pipe.inpaint_grow !== "") pipe.inpaint_grow = U.finiteNumber(pipe.inpaint_grow, 6);
    }
  }

  async function loadProject(id) {
    const data = await api("/zeroimagestudio/project/" + encodeURIComponent(id));
    const meta = data.meta || {};
    editor.clearHistory();
    state.projectId = id;
    if (meta.state) Object.assign(state, {
      projectName: meta.state.projectName || meta.name || state.projectName,
      pipeline: meta.state.pipeline || state.pipeline,
      hintId: meta.state.hintId || state.hintId,
      prompt: meta.state.prompt ?? state.prompt,
      negative: meta.state.negative ?? state.negative,
      promptPresets: meta.state.promptPresets || state.promptPresets,
      sampler: meta.state.sampler || state.sampler,
      create: meta.state.create || state.create,
      edit: meta.state.edit || state.edit,
      area: meta.state.area || state.area,
      color: meta.state.color || state.color,
      brush: meta.state.brush || state.brush,
      maskFocus: meta.state.maskFocus || null,
      workMaskHidden: !!meta.state.workMaskHidden,
    });
    if (meta.state.kreaTaskSlots && typeof meta.state.kreaTaskSlots === "object") {
      state.kreaTaskSlots = meta.state.kreaTaskSlots;
      state._taskSlotsLoaded = true;
      saveTaskSlots();
    } else loadTaskSlots();
    state.hintId = canonicalHintId(state.hintId);
    state.hintByMode[state.pipeline] = state.hintId;
    if (Array.isArray(state.promptPresets)) state.promptPresets = state.promptPresets.map((p, i) => normalizePreset(p, i));
    sanitizeLoadedState();
    editor.doc = meta.canvas || editor.doc;
    editor.gen = meta.gen || editor.gen;
    editor.resizeMask();
    editor.layers = [];
    for (const layer of meta.layers || []) {
      const img = await loadImage(projectFileUrl(id, layer.file));
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      const obj = editor.makeLayer(String(layer.name || "Слой").slice(0, 200), c);
      Object.assign(obj, {
        id: U.safeId(layer.id, "l" + editor.layers.length),
        x: U.finiteNumber(layer.x, 0),
        y: U.finiteNumber(layer.y, 0),
        visible: layer.visible !== false,
        opacity: U.finiteNumber(layer.opacity, 1),
        blend: layer.blend || "normal",
        locked: !!layer.locked,
        meta: layer.meta || null,
      });
      editor.thumb(obj);
      if (layer.mask) {
        try {
          const mimg = await loadImage(projectFileUrl(id, layer.mask));
          const mc = document.createElement("canvas");
          mc.width = mimg.width; mc.height = mimg.height;
          mc.getContext("2d").drawImage(mimg, 0, 0);
          obj.mask = { canvas: mc, ctx: mc.getContext("2d"), visible: true };
          editor.maskThumb(obj);
        } catch { /* layer has no stored mask */ }
      }
      editor.layers.push(obj);
    }
    if (state.maskFocus && state.maskFocus.id && !editor.layers.some((l) => l.id === state.maskFocus.id && l.mask)) state.maskFocus = null;
    if (meta.mask) {
      try {
        const img = await loadImage(projectFileUrl(id, meta.mask));
        editor.maskCtx.clearRect(0, 0, editor.doc.w, editor.doc.h);
        editor.maskCtx.drawImage(img, 0, 0);
      } catch { /* no mask */ }
    }
    state.references = [];
    for (const ref of meta.references || []) {
      const img = await loadImage(projectFileUrl(id, ref.file));
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      state.references.push({
        id: U.safeId(ref.id, "r" + state.references.length),
        name: String(ref.name || "Реф").slice(0, 200),
        canvas: c,
        url: c.toDataURL("image/png"),
      });
    }
    editor.active = Math.max(0, editor.layers.length - 1);
    editor.clearHistory();
    editor.touchMask();
    if (!state.area.userPlaced) syncDefaultArea();
    editor.fit();
    state.dirty = false;
    rememberProject(id, state.projectName);
    renderAll();
  }

  function layerHasPixels(layer) {
    if (!layer || !layer.canvas || !layer.ctx) return false;
    const w = layer.canvas.width;
    const h = layer.canvas.height;
    if (w < 1 || h < 1) return false;
    let data;
    try { data = layer.ctx.getImageData(0, 0, w, h).data; }
    catch { return true; }
    const stride = Math.max(4, Math.floor((w * h) / 5000) * 4);
    for (let i = 3; i < data.length; i += stride) if (data[i] > 8) return true;
    return false;
  }

  function canvasIsEmpty() {
    return !editor || !editor.layers.some(layerHasPixels);
  }

  function contentBounds(layers) {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const layer of layers) {
      const w = Math.max(1, Math.round(layer.canvas.width * (layer.scaleX || 1)));
      const h = Math.max(1, Math.round(layer.canvas.height * (layer.scaleY || 1)));
      x1 = Math.min(x1, layer.x);
      y1 = Math.min(y1, layer.y);
      x2 = Math.max(x2, layer.x + w);
      y2 = Math.max(y2, layer.y + h);
    }
    if (!Number.isFinite(x1)) return null;
    return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
  }

  function adoptCanvasSize(w, h) {
    const step = modelStep();
    const size = window.ZeroImageStudioSize.cropSizeToStep(w, h, step);
    editor.doc = { w: size.w, h: size.h };
    editor.resizeMask();
    editor.touchMask();
    if (state.area.editScope !== "region") {
      state.area.userPlaced = false;
      state.area.outputLinked = true;
      syncDefaultArea();
    } else {
      editor.gen = window.ZeroImageStudioSize.snapRect(editor.gen, step, editor.doc);
      state.area.region = { x: editor.gen.x, y: editor.gen.y, w: editor.gen.w, h: editor.gen.h };
    }
    return size;
  }

  function placeImportedCanvas(canvas, name, mode) {
    editor.pushUndo(editor.fullSnapshot());
    const title = String(name || "Фото").replace(/\.[^.]+$/, "");
    if (mode === "fit") {
      const box = window.ZeroImageStudioSize.containInside(canvas.width, canvas.height, editor.doc.w, editor.doc.h);
      const fitted = document.createElement("canvas");
      fitted.width = box.w;
      fitted.height = box.h;
      fitted.getContext("2d").drawImage(canvas, 0, 0, box.w, box.h);
      const layer = editor.makeLayer(title, fitted);
      layer.x = box.x;
      layer.y = box.y;
      editor.addLayer(layer);
      toast("Изображение вписано в холст.");
    } else if (mode === "grow") {
      const size = adoptCanvasSize(canvas.width, canvas.height);
      const layer = editor.makeLayer(title, canvas);
      layer.x = 0;
      layer.y = 0;
      editor.addLayer(layer);
      toast(`Холст ${size.w} × ${size.h}.`);
    } else {
      const size = adoptCanvasSize(canvas.width, canvas.height);
      const layer = editor.makeLayer(title, canvas);
      editor.resizeMask();
      editor.maskCtx.clearRect(0, 0, editor.doc.w, editor.doc.h);
      editor.touchMask();
      editor.layers = [layer];
      editor.active = 0;
      state.maskFocus = null;
      state.workMaskHidden = false;
      state.area.userPlaced = false;
      state.area.outputLinked = true;
      state.area.editScope = "full";
      syncDefaultArea();
      toast(`Холст ${size.w} × ${size.h}.`);
    }
    editor.thumb(editor.activeLayer());
    editor.fit();
    state.dirty = true;
    editor.requestDraw();
    renderLayers();
    renderInspector();
    renderPipe();
    paintStatus();
    updateGenerateButton();
  }

  function fitCanvasToContent(which) {
    const selected = editor.activeLayer();
    const layers = which === "layer" && selected ? [selected] : editor.layers.filter((layer) => layer.visible !== false);
    if (!layers.length) { toast("Нет слоя, под который подогнать холст."); return; }
    const box = contentBounds(layers);
    if (!box) { toast("Нет слоя, под который подогнать холст."); return; }
    const step = modelStep();
    const size = window.ZeroImageStudioSize.cropSizeToStep(box.w, box.h, step);
    editor.pushUndo(editor.fullSnapshot());
    const dx = Math.round(box.x);
    const dy = Math.round(box.y);
    for (const layer of editor.layers) {
      layer.x -= dx;
      layer.y -= dy;
    }
    const prevMask = editor.maskCanvas;
    const mc = document.createElement("canvas");
    mc.width = size.w;
    mc.height = size.h;
    mc.getContext("2d").drawImage(prevMask, -dx, -dy);
    editor.doc = { w: size.w, h: size.h };
    editor.maskCanvas = mc;
    editor.maskCtx = mc.getContext("2d");
    editor.touchMask();
    if (state.area.editScope === "region") {
      editor.gen = window.ZeroImageStudioSize.snapRect({
        x: editor.gen.x - dx, y: editor.gen.y - dy, w: editor.gen.w, h: editor.gen.h,
      }, step, editor.doc);
      state.area.region = { x: editor.gen.x, y: editor.gen.y, w: editor.gen.w, h: editor.gen.h };
    } else {
      state.area.userPlaced = false;
      state.area.outputLinked = true;
      syncDefaultArea();
    }
    editor.fit();
    state.dirty = true;
    editor.requestDraw();
    renderLayers();
    renderInspector();
    renderPipe();
    paintStatus();
    toast(`Холст ${size.w} × ${size.h}.`);
  }

  function readImportMp() {
    let raw = "off";
    try { raw = localStorage.getItem("zeroimagestudio.importMp") || "off"; } catch (err) { /* private mode */ }
    if (raw === "off") return { mode: "off", value: 0, key: "off" };
    if (String(raw).startsWith("custom:")) {
      const value = Math.max(0.1, parseFloat(String(raw).slice(7)) || 1);
      return { mode: "custom", value, key: "custom" };
    }
    const value = parseFloat(raw);
    return Number.isFinite(value) ? { mode: "preset", value, key: String(value) } : { mode: "off", value: 0, key: "off" };
  }

  function writeImportMp(mp) {
    const raw = mp.mode === "off" ? "off" : mp.mode === "custom" ? "custom:" + mp.value : String(mp.value);
    try { localStorage.setItem("zeroimagestudio.importMp", raw); } catch (err) { /* private mode */ }
  }

  function snapDown16(v) {
    if (v < 16) return Math.max(1, Math.round(v));
    return Math.floor(v / 16) * 16;
  }

  function importOutputSize(cropW, cropH, mp) {
    let w = cropW;
    let h = cropH;
    if (mp && mp.mode !== "off" && mp.value > 0) {
      const pixels = cropW * cropH;
      const budget = mp.value * 1e6;
      if (pixels > budget) {
        const scale = Math.sqrt(budget / pixels);
        w *= scale;
        h *= scale;
      }
    }
    w = Math.min(w, cropW);
    h = Math.min(h, cropH);
    const step = modelStep();
    const cropped = window.ZeroImageStudioSize.cropSizeToStep(w, h, step);
    return { w: cropped.w, h: cropped.h, scaled: w < cropW - 0.5 || h < cropH - 0.5 };
  }

  function upsertAsset(asset) {
    if (!asset || !asset.id) return;
    const rest = (state.assets || []).filter((item) => item.id !== asset.id);
    state.assets = [asset, ...rest];
    if (state.galleryKind === "assets") renderGallery();
  }

  async function rememberAsset(file, role, importSettings) {
    const body = file instanceof File ? file : new File([file], "image.png", { type: file.type || "image/png" });
    const fd = new FormData();
    fd.append("file", body, body.name || "image.png");
    fd.append("role", role);
    if (state.projectId) fd.append("project_id", state.projectId);
    if (importSettings) fd.append("import", JSON.stringify(importSettings));
    const saved = await api("/zeroimagestudio/assets", { method: "POST", body: fd });
    upsertAsset(saved);
    return saved;
  }

  async function blobForAsset(id) {
    const res = await fetch("/zeroimagestudio/assets/" + encodeURIComponent(id) + "/file");
    if (!res.ok) throw new Error("Не удалось открыть ассет.");
    return res.blob();
  }

  async function openAssetOnCanvas(id) {
    const asset = (state.assets || []).find((item) => item.id === id);
    const blob = await blobForAsset(id);
    const img = await loadImage(URL.createObjectURL(blob));
    const file = new File([blob], (asset && asset.name) || "asset.png", { type: blob.type || "image/png" });
    await offerImportImage(img, file.name, file, asset && asset.import);
  }

  async function addAssetAsReference(id) {
    const asset = (state.assets || []).find((item) => item.id === id);
    const blob = await blobForAsset(id);
    const img = await loadImage(URL.createObjectURL(blob));
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    c.getContext("2d").drawImage(img, 0, 0);
    state.references.push({ id: "r" + Math.random().toString(36).slice(2, 7), name: (asset && asset.name) || ("#" + (state.references.length + 1)), canvas: c, url: c.toDataURL("image/png") });
    renderRefs();
    const file = new File([blob], (asset && asset.name) || "ref.png", { type: blob.type || "image/png" });
    try { await rememberAsset(file, "reference", asset && asset.import); }
    catch (err) { toast(err.message || String(err)); }
  }

  async function deleteAsset(id) {
    const asset = (state.assets || []).find((item) => item.id === id);
    const name = (asset && asset.name) || "ассет";
    if (!window.confirm("Удалить ассет «" + name + "»? Холст не изменится.")) return;
    await api("/zeroimagestudio/assets/" + encodeURIComponent(id), { method: "DELETE" });
    state.assets = (state.assets || []).filter((item) => item.id !== id);
    renderGallery();
  }

  function offerImportImage(img, name, sourceFile, preset) {
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;
    const locks = [["free", "Свободно"], ["source", "Исходное"], ["1:1", "1:1"], ["2:3", "2:3"], ["3:2", "3:2"], ["3:4", "3:4"], ["4:3", "4:3"], ["9:16", "9:16"], ["16:9", "16:9"]];
    const mpPresets = [["off", "Без ограничения"], ["1", "1"], ["1.5", "1.5"], ["2", "2"], ["4", "4"], ["8", "8"], ["custom", "Своё"]];
    let lock = (preset && locks.some(([id]) => id === preset.aspect) && preset.aspect) || "free";
    let swapped = false;
    let mp = preset && preset.mp ? readStoredMp(preset.mp) : readImportMp();
    const minW = Math.min(16, imgW);
    const minH = Math.min(16, imgH);
    const clampCrop = (c) => {
      let x = c.x, y = c.y, w = c.w, h = c.h;
      if (w < 0) { x += w; w = -w; }
      if (h < 0) { y += h; h = -h; }
      w = Math.max(minW, Math.min(w, imgW));
      h = Math.max(minH, Math.min(h, imgH));
      x = Math.max(0, Math.min(x, imgW - w));
      y = Math.max(0, Math.min(y, imgH - h));
      return { x, y, w, h };
    };
    let crop = clampCrop(preset && preset.w > 8 && preset.h > 8
      ? { x: preset.x || 0, y: preset.y || 0, w: preset.w, h: preset.h }
      : { x: 0, y: 0, w: imgW, h: imgH });
    const currentRatio = () => {
      if (lock === "free") return Math.max(crop.w, 1) / Math.max(crop.h, 1);
      if (lock === "source") return swapped ? imgH / imgW : imgW / imgH;
      const [a, b] = lock.split(":").map(Number);
      const ratio = a / b;
      return swapped ? 1 / ratio : ratio;
    };
    const fitRatio = (ratio) => {
      let w = imgW;
      let h = w / ratio;
      if (h > imgH) { h = imgH; w = h * ratio; }
      return clampCrop({ x: (imgW - w) / 2, y: (imgH - h) / 2, w, h });
    };
    const blankCanvas = canvasIsEmpty();
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "modal-back";
      back.innerHTML = `<div class="modal import" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <h3 id="import-title">Импорт изображения</h3>
        <div class="mu">${escapeHtml(name || "изображение")} · исходник ${imgW}×${imgH}. Файл на диске не меняется.</div>
        <div class="import-stage"><canvas id="import-view"></canvas></div>
        <div class="mu">Кадр</div>
        <div class="import-aspects" id="import-aspects">${locks.map(([id, label]) => `<button type="button" class="b s" data-lock="${id}">${label}</button>`).join("")}<button type="button" class="b s" data-swap="1" title="Портрет или альбом">⇄</button></div>
        <div class="mu">Максимум, мегапиксели. Только уменьшение, кратно 16.</div>
        <div class="import-mps" id="import-mps">${mpPresets.map(([id, label]) => `<button type="button" class="b s" data-mp="${id}">${label}</button>`).join("")}<input id="import-custom" class="f" inputmode="decimal" style="width:72px" hidden></div>
        <div class="mu" id="import-live"></div>
        <div class="row" id="import-place" ${blankCanvas ? "hidden" : ""}>
          <label class="row"><input type="radio" name="import-place" value="grow"> Холст под изображение</label>
          <label class="row"><input type="radio" name="import-place" value="fit"> Вписать в холст</label>
        </div>
        <div class="mu" id="import-blank" ${blankCanvas ? "" : "hidden"}>Пустой холст примет размер изображения.</div>
        <div class="row" style="justify-content:flex-end">
          <button type="button" class="b" data-cancel="1">Отмена</button>
          <button type="button" class="b ac" data-ok="1">Импорт</button>
        </div>
      </div>`;
      const canvas = back.querySelector("#import-view");
      const maxW = Math.min(760, window.innerWidth - 80);
      const fit = Math.min(maxW / imgW, 360 / imgH, 4);
      canvas.width = Math.max(1, Math.round(imgW * fit));
      canvas.height = Math.max(1, Math.round(imgH * fit));
      let drag = null;
      const paint = () => {
        const g = canvas.getContext("2d");
        g.clearRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        const sx = canvas.width / imgW;
        const sy = canvas.height / imgH;
        const x = crop.x * sx, y = crop.y * sy, w = crop.w * sx, h = crop.h * sy;
        g.fillStyle = "rgba(0,0,0,.55)";
        g.beginPath();
        g.rect(0, 0, canvas.width, canvas.height);
        g.rect(x, y, w, h);
        g.fill("evenodd");
        g.strokeStyle = "#ff7a1a";
        g.lineWidth = 2;
        g.strokeRect(x + 1, y + 1, Math.max(0, w - 2), Math.max(0, h - 2));
        g.fillStyle = "#ff7a1a";
        [[x, y], [x + w / 2, y], [x + w, y], [x + w, y + h / 2], [x + w, y + h], [x + w / 2, y + h], [x, y + h], [x, y + h / 2]].forEach(([hx, hy]) => {
          g.fillRect(hx - 4, hy - 4, 8, 8);
        });
        back.querySelectorAll("[data-lock]").forEach((b) => b.classList.toggle("on", b.dataset.lock === lock));
        back.querySelectorAll("[data-mp]").forEach((b) => b.classList.toggle("on", b.dataset.mp === mp.key));
        const custom = back.querySelector("#import-custom");
        custom.hidden = mp.mode !== "custom";
        if (mp.mode === "custom" && document.activeElement !== custom) custom.value = String(mp.value);
        const out = importOutputSize(crop.w, crop.h, mp);
        const mpText = ((out.w * out.h) / 1e6).toFixed(2);
        back.querySelector("#import-live").textContent = `Источник ${imgW}×${imgH} → ${out.w}×${out.h} · ${mpText} МП · без растяжения`;
      };
      const point = (ev) => {
        const r = canvas.getBoundingClientRect();
        return {
          x: ((ev.clientX - r.left) / r.width) * imgW,
          y: ((ev.clientY - r.top) / r.height) * imgH,
        };
      };
      const hit = (ev) => {
        const r = canvas.getBoundingClientRect();
        const px = ev.clientX - r.left;
        const py = ev.clientY - r.top;
        const sx = r.width / imgW;
        const sy = r.height / imgH;
        const x = crop.x * sx, y = crop.y * sy, w = crop.w * sx, h = crop.h * sy;
        const pts = { nw: [x, y], n: [x + w / 2, y], ne: [x + w, y], e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h], sw: [x, y + h], w: [x, y + h / 2] };
        for (const [name, pos] of Object.entries(pts)) {
          if (Math.abs(px - pos[0]) <= 8 && Math.abs(py - pos[1]) <= 8) return name;
        }
        if (px >= x && px <= x + w && py >= y && py <= y + h) return "move";
        return null;
      };
      canvas.addEventListener("pointerdown", (ev) => {
        const handle = hit(ev);
        if (!handle) return;
        drag = { handle, p: point(ev), crop: { ...crop } };
        canvas.setPointerCapture(ev.pointerId);
      });
      canvas.addEventListener("pointermove", (ev) => {
        if (!drag) {
          const handle = hit(ev);
          canvas.style.cursor = handle === "move" ? "move" : handle ? "crosshair" : "default";
          return;
        }
        const p = point(ev);
        if (drag.handle === "move") {
          crop = clampCrop({ x: drag.crop.x + (p.x - drag.p.x), y: drag.crop.y + (p.y - drag.p.y), w: drag.crop.w, h: drag.crop.h });
        } else {
          const start = drag.crop;
          let x1 = start.x, y1 = start.y, x2 = start.x + start.w, y2 = start.y + start.h;
          if (drag.handle.includes("w")) x1 = p.x;
          if (drag.handle.includes("e")) x2 = p.x;
          if (drag.handle.includes("n")) y1 = p.y;
          if (drag.handle.includes("s")) y2 = p.y;
          let w = x2 - x1, h = y2 - y1;
          if (lock !== "free") {
            const ratio = currentRatio();
            const edge = drag.handle.length === 1;
            if (edge && (drag.handle === "n" || drag.handle === "s")) w = Math.abs(h) * ratio * Math.sign(w || 1);
            else if (edge) h = Math.abs(w) / ratio * Math.sign(h || 1);
            else if (Math.abs(w) / ratio > Math.abs(h)) h = Math.abs(w) / ratio * Math.sign(h || 1);
            else w = Math.abs(h) * ratio * Math.sign(w || 1);
            if (drag.handle.includes("w")) x1 = x2 - w; else x2 = x1 + w;
            if (drag.handle.includes("n")) y1 = y2 - h; else y2 = y1 + h;
            if (drag.handle === "n" || drag.handle === "s") {
              const cx = start.x + start.w / 2;
              x1 = cx - w / 2; x2 = x1 + w;
            }
            if (drag.handle === "e" || drag.handle === "w") {
              const cy = start.y + start.h / 2;
              y1 = cy - h / 2; y2 = y1 + h;
            }
          }
          crop = clampCrop({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
        }
        paint();
      });
      canvas.addEventListener("pointerup", () => { drag = null; });
      const finish = (ok) => {
        const picked = back.querySelector('input[name="import-place"]:checked');
        const mode = blankCanvas ? "new" : (picked && picked.value === "grow" ? "grow" : "fit");
        window.removeEventListener("keydown", onKey, true);
        back.remove();
        resolve(ok ? mode : null);
      };
      const doImport = () => {
        const custom = back.querySelector("#import-custom");
        if (mp.mode === "custom" && custom) mp = { mode: "custom", value: Math.max(0.1, parseFloat(custom.value) || mp.value), key: "custom" };
        finish(true);
      };
      const onKey = (ev) => {
        if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); finish(false); }
        if (ev.key === "Enter") { ev.preventDefault(); ev.stopPropagation(); doImport(); }
      };
      window.addEventListener("keydown", onKey, true);
      back.addEventListener("click", (ev) => {
        const lockBtn = ev.target.closest("[data-lock]");
        const mpBtn = ev.target.closest("[data-mp]");
        if (lockBtn) {
          lock = lockBtn.dataset.lock;
          swapped = false;
          if (lock !== "free") crop = fitRatio(currentRatio());
          paint();
        } else if (ev.target.closest("[data-swap]")) {
          if (lock === "free") {
            const cx = crop.x + crop.w / 2, cy = crop.y + crop.h / 2;
            crop = clampCrop({ x: cx - crop.h / 2, y: cy - crop.w / 2, w: crop.h, h: crop.w });
          } else {
            swapped = !swapped;
            crop = fitRatio(currentRatio());
          }
          paint();
        } else if (mpBtn) {
          const id = mpBtn.dataset.mp;
          if (id === "off") mp = { mode: "off", value: 0, key: "off" };
          else if (id === "custom") {
            mp = { mode: "custom", value: mp.mode === "custom" ? mp.value : 1, key: "custom" };
            const custom = back.querySelector("#import-custom");
            custom.hidden = false;
            custom.value = String(mp.value);
            custom.focus();
          } else mp = { mode: "preset", value: parseFloat(id), key: id };
          writeImportMp(mp);
          paint();
        } else if (ev.target.closest("[data-cancel]")) finish(false);
        else if (ev.target.closest("[data-ok]")) doImport();
      });
      back.querySelector("#import-custom").addEventListener("change", (ev) => {
        mp = { mode: "custom", value: Math.max(0.1, parseFloat(ev.target.value) || 1), key: "custom" };
        writeImportMp(mp);
        paint();
      });
      const radios = back.querySelectorAll('input[name="import-place"]');
      radios.forEach((radio) => { radio.checked = radio.value === "fit"; });
      document.body.appendChild(back);
      paint();
      back.querySelector("[data-ok]").focus();
    }).then(async (mode) => {
      if (mode == null) return;
      writeImportMp(mp);
      const out = importOutputSize(crop.w, crop.h, mp);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, out.w);
      canvas.height = Math.max(1, out.h);
      const g = canvas.getContext("2d");
      if (out.scaled) {
        const scale = Math.min(out.w / crop.w, out.h / crop.h, 1);
        const fullW = Math.max(out.w, Math.round(crop.w * scale));
        const fullH = Math.max(out.h, Math.round(crop.h * scale));
        const tmp = document.createElement("canvas");
        tmp.width = fullW;
        tmp.height = fullH;
        tmp.getContext("2d").drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, fullW, fullH);
        g.drawImage(tmp, Math.floor((fullW - out.w) / 2), Math.floor((fullH - out.h) / 2), out.w, out.h, 0, 0, out.w, out.h);
      } else {
        const ox = crop.x + (crop.w - out.w) / 2;
        const oy = crop.y + (crop.h - out.h) / 2;
        g.drawImage(img, ox, oy, out.w, out.h, 0, 0, out.w, out.h);
      }
      placeImportedCanvas(canvas, name, mode);
      if (sourceFile) {
        const settings = {
          x: Math.round(crop.x), y: Math.round(crop.y), w: Math.round(crop.w), h: Math.round(crop.h),
          aspect: lock, mp: mp.mode === "off" ? "off" : mp.mode === "custom" ? "custom:" + mp.value : String(mp.value),
          out_w: canvas.width, out_h: canvas.height,
        };
        try { await rememberAsset(sourceFile, "canvas", settings); }
        catch (err) { toast(err.message || String(err)); }
      }
    });
  }

  function readStoredMp(raw) {
    if (raw === "off") return { mode: "off", value: 0, key: "off" };
    if (String(raw).startsWith("custom:")) return { mode: "custom", value: Math.max(0.1, parseFloat(String(raw).slice(7)) || 1), key: "custom" };
    const value = parseFloat(raw);
    return Number.isFinite(value) ? { mode: "preset", value, key: String(value) } : readImportMp();
  }

  async function loadExample() {
    const img = await loadImage("assets/portrait.svg");
    editor.doc = { w: 800, h: 1000 };
    editor.resizeMask();
    editor.gen = { x: 144, y: 70, w: 512, h: 512 };
    const c = document.createElement("canvas");
    c.width = 800; c.height = 1000;
    c.getContext("2d").drawImage(img, 0, 0, 800, 1000);
    const layer = editor.makeLayer("Оригинал", c);
    layer.locked = true;
    editor.layers = [layer];
    editor.active = 0;
    editor.thumb(layer);
    editor.fit();
    renderAll();
  }

  async function collapseZeroImageStudio() {
    let skipSave = false;
    if (state.dirty) {
      const choice = await new Promise((resolve) => {
        const back = document.createElement("div");
        back.className = "modal-back";
        back.innerHTML = `<div class="modal"><h3>Проект не сохранён</h3>
          <div class="mu">Есть несохранённые правки. Автосохранение пишет проект раз в 3 минуты.</div>
          <div class="row" style="flex-wrap:wrap">
            <button class="b ac" type="button" data-save="1">Сохранить и свернуть</button>
            <button class="b" type="button" data-drop="1">Свернуть всё равно</button>
            <button class="b" type="button" data-cancel="1">Отмена</button>
          </div></div>`;
        const done = (v) => { back.remove(); resolve(v); };
        back.querySelector("[data-save]").onclick = () => done("save");
        back.querySelector("[data-drop]").onclick = () => done("drop");
        back.querySelector("[data-cancel]").onclick = () => done("cancel");
        document.body.appendChild(back);
      });
      if (choice === "cancel") return;
      if (choice === "save") {
        try { await saveProject(); } catch (err) { toast(err.message || String(err)); return; }
      } else if (choice === "drop") {
        skipSave = true;
      }
    }
    try {
      const id = skipSave ? (state.projectId || "") : await saveProject();
      const flat = editor.flatten();
      const mask = editor.exportMask();
      const fd = new FormData();
      fd.append("image", await canvasBlob(flat), "flat.png");
      fd.append("mask", await canvasBlob(mask), "mask.png");
      fd.append("meta", JSON.stringify({ projectId: id, name: state.projectName, layers: editor.layers.map((l) => ({ name: l.name, blend: l.blend, opacity: l.opacity, meta: l.meta })) }));
      const saved = await api("/zeroimagestudio/commit", { method: "POST", body: fd });
      const preview = flat.toDataURL("image/jpeg", 0.8);
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({
          type: "zeroimagestudio-collapse",
          projectId: id,
          image: saved.image,
          mask: saved.mask,
          layers: JSON.stringify(editor.exportMeta().layers),
          preview,
          name: state.projectName,
          info: { layers: editor.layers.length, doc: editor.doc, preset: $("preset-select").selectedOptions[0] ? $("preset-select").selectedOptions[0].textContent : "" },
        }, "*");
      } else {
        toast("Сведено в " + saved.image + ". Откройте ZeroImageStudio из ноды, чтобы вернуть кадр в граф.");
      }
      state.collapsed = true;
      syncStudioPause();
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  function applyHint(h) {
    rememberTaskLora();
    const pipes = hintPipelines(h);
    if (!pipes.includes(state.pipeline)) state.pipeline = pipes[0];
    state.hintId = canonicalHintId(h.id);
    state.hintByMode[state.pipeline] = state.hintId;
    const target = cfg();
    const d = h.defaults || {};
    ["loader", "clip_type", "weight_dtype", "latent_mode", "encoder"].forEach((k) => {
      if (d[k] != null) target[k] = d[k];
    });
    ["unet", "clip", "vae", "checkpoint"].forEach((k) => {
      if (d[k] == null || (target[k] || "").trim()) return;
      target[k] = d[k];
    });
    if (state.pipeline === "edit" && h.edit_method) target.method = h.edit_method;
    if (h.qwen_resolution) target.qwen_resolution = h.qwen_resolution;
    const keepTask = target.krea && target.krea.task;
    if (h.krea) target.krea = { ...(target.krea || {}), ...h.krea };
    if (keepTask && target.krea) target.krea.task = keepTask;
    if (h.sampler) Object.assign(state.sampler, h.sampler);
    syncDefaultArea();
    if (h.lora && h.lora.name && target.method !== "krea2_edit") {
      const existing = target.loras.find((l) => l.name === h.lora.name);
      if (!existing) target.loras.push({ triggers: [], trigger_mode: "off", ...h.lora });
    }
    if (target.method === "krea2_edit") {
      if (!target.krea.task) target.krea.task = "general";
      if (!keepTask) applyKreaTaskDefaults(target.krea.task);
      else applyKreaPlacement(target.krea.task);
    }
    // A suggested name that is not on disk stays empty. A file the user already chose stays.
    const cat = state.catalog || {};
    const resolveInstalled = (list, name, suggested) => {
      if (!name) return "";
      if (!list) return name;
      if (list.includes(name)) return name;
      const hit = list.find((n) => basenameOf(n) === basenameOf(name));
      if (hit) return hit;
      if (suggested && basenameOf(name) === basenameOf(suggested)) return "";
      return name;
    };
    if (cat.unets) target.unet = resolveInstalled(cat.unets, target.unet, d.unet);
    if (cat.clips) target.clip = resolveInstalled(cat.clips, target.clip, d.clip);
    if (cat.vaes) target.vae = resolveInstalled(cat.vaes, target.vae, d.vae);
    if (cat.checkpoints) target.checkpoint = resolveInstalled(cat.checkpoints, target.checkpoint, d.checkpoint);
    renderAll();
  }

  function applyPreset(p) {
    if (!p) return;
    ["pipeline", "hintId", "prompt", "negative", "sampler", "create", "edit", "area", "promptPresets"].forEach((k) => {
      if (p[k] != null) state[k] = JSON.parse(JSON.stringify(p[k]));
    });
    renderAll();
    toast("Пресет «" + p.name + "» загружен.");
  }

  function applyMeta(meta) {
    if (!meta) return;
    state.prompt = meta.prompt || state.prompt;
    state.negative = meta.negative || "";
    state.pipeline = meta.pipeline || state.pipeline;
    if (meta.edit_method) cfg().method = meta.edit_method;
    Object.assign(state.sampler, {
      seed: meta.seed ?? state.sampler.seed,
      steps: meta.steps ?? state.sampler.steps,
      cfg: meta.cfg ?? state.sampler.cfg,
      denoise: meta.denoise ?? state.sampler.denoise,
      sampler: meta.sampler || state.sampler.sampler,
      scheduler: meta.scheduler || state.sampler.scheduler,
    });
    const c = cfg();
    ["loader", "unet", "clip", "vae", "checkpoint", "clip_type"].forEach((k) => { if (meta[k]) c[k] = meta[k]; });
    if (meta.loras) c.loras = meta.loras.map((l) => ({ enabled: true, strength_model: 1, strength_clip: 1, trigger_mode: "end", triggers: [], ...l }));
    if (meta.width) state.area.outW = meta.width;
    if (meta.height) state.area.outH = meta.height;
    renderAll();
    toast("Настройки кадра подставлены. Генерация не запускалась.");
  }

  function useGalleryMeta(it, mode) {
    const m = (it && it.meta) || {};
    if (mode === "apply") {
      applyMeta(m);
      document.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === "canvas"));
      document.body.dataset.tab = "canvas";
      if (editor) requestAnimationFrame(() => editor.resizeView());
      return;
    }
    if (mode === "seed") {
      if (m.seed != null) state.sampler.seed = U.finiteNumber(m.seed, state.sampler.seed);
      renderSampler();
      return;
    }
    if (mode === "lora" && m.loras) {
      cfg().loras = m.loras.map((l) => ({ enabled: true, strength_clip: l.strength_model, trigger_mode: "end", triggers: [], ...l }));
      renderLoras();
    }
  }

  function showPop(it, anchor) {
    const pop = $("pop");
    const m = it.meta || {};
    const loras = (m.loras || []).map((l) => `${escapeHtml(l.name)} ${U.finiteNumber(l.strength_model, 0)}`).join("<br>") || "—";
    const side = m.width && m.height ? (U.finiteNumber(m.width, 0) + "×" + U.finiteNumber(m.height, 0)) : "?";
    const seed = m.seed == null || m.seed === "" ? "" : U.finiteNumber(m.seed, 0);
    pop.hidden = false;
    pop.innerHTML = `
      <div class="row" style="padding:8px 10px;border-bottom:1px solid #3a404c"><b>${escapeHtml(m.model_label || "Генерация")}</b><span class="mu mono" style="margin-left:auto;font-size:10.5px">${side}</span></div>
      <div style="padding:8px 10px"><table>
        <tr><td>Модель</td><td>${escapeHtml(m.model_label || m.unet || m.checkpoint || "")}</td></tr>
        <tr><td>Seed</td><td class="mono">${seed}</td></tr>
        <tr><td>Сэмплер</td><td class="mono">${escapeHtml(m.sampler || "")}/${escapeHtml(m.scheduler || "")} · ${U.finiteNumber(m.steps, 0)} · CFG ${U.finiteNumber(m.cfg, 0)}</td></tr>
        <tr><td>LoRA</td><td class="mono">${loras}</td></tr>
        <tr><td>Промт</td><td>${escapeHtml((m.final_prompt || m.prompt || "").slice(0, 180))}</td></tr>
      </table>
      <div class="row" style="margin-top:8px"><button class="b ac s" id="pop-apply" data-i="undo" data-s="12">Применить заново</button><button class="b s" id="pop-seed">Seed</button><button class="b s" id="pop-lora">LoRA</button></div></div>`;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - 280) + "px";
    pop.style.top = Math.max(8, r.bottom + 8) + "px";
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(pop);
    $("pop-apply").onclick = () => { useGalleryMeta(it, "apply"); pop.hidden = true; };
    $("pop-seed").onclick = () => { useGalleryMeta(it, "seed"); pop.hidden = true; };
    $("pop-lora").onclick = () => { useGalleryMeta(it, "lora"); pop.hidden = true; };;
  }

  function jpegCanvas(canvas, maxSide) {
    const w = canvas.width || 1;
    const h = canvas.height || 1;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    return scaleCanvas(canvas, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale))).toDataURL("image/jpeg", 0.72);
  }

  function llmReferenceCanvases() {
    const picked = state.references.filter((r) => r.selected);
    return (picked.length ? picked : state.references).slice(0, 3);
  }

  async function runLlm(mode) {
    try {
      const presetId = $("llm-preset").value;
      const preset = (state.settings && state.settings.llm_presets || []).find((p) => p.id === presetId);
      const body = { mode, prompt: state.prompt, system: preset && preset.systems ? preset.systems[mode] : undefined };
      const images = [];
      if (mode === "describe") {
        const flat = editor.flatten();
        images.push(jpegCanvas(flat, 512));
      }
      if (mode === "describe" || mode === "improve") {
        for (const ref of llmReferenceCanvases()) {
          if (images.length >= 4) break;
          images.push(jpegCanvas(ref.canvas, 512));
        }
      }
      if (images.length) body.images = images;
      $("gen-label").textContent = "LLM…";
      const res = await api("/zeroimagestudio/llm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (mode === "extend") state.prompt = (state.prompt ? state.prompt.replace(/[, ]*$/, "") + ", " : "") + res.text;
      else state.prompt = res.text;
      $("prompt").value = state.prompt;
      updateFinal();
    } catch (err) {
      toast(err.message || String(err));
    } finally {
      $("gen-label").textContent = "Сгенерировать";
    }
  }

  function openModal(html, onBind) {
    const host = $("modal");
    host.innerHTML = `<div class="modal-back"><div class="modal">${html}<div class="row" style="justify-content:flex-end"><button class="b" data-close="1">Закрыть</button><button class="b ac" data-ok="1">Сохранить</button></div></div></div>`;
    host.querySelector("[data-close]").onclick = () => { host.innerHTML = ""; };
    onBind(host.querySelector(".modal"), () => { host.innerHTML = ""; });
  }

  function openSettings() {
    const s = state.settings || {};
    const civPlaceholder = s.has_civitai_token ? "сохранён — введите новый, чтобы заменить" : "";
    const keyPlaceholder = s.has_llm_key ? "сохранён — введите новый, чтобы заменить" : "";
    openModal(`<h3>Настройки</h3>
      <div class="mu">Civitai API key (необязательно, для скрытых моделей)</div>
      <input id="set-civ" type="password" value="" placeholder="${escapeHtml(civPlaceholder)}" autocomplete="new-password">
      <div class="mu">LLM, OpenAI-совместимый адрес (Ollama, llama.cpp, LM Studio). Пример: http://127.0.0.1:11434/v1</div>
      <input id="set-base" type="text" value="${escapeHtml(s.llm_base || "")}">
      <div class="mu">Имя модели</div>
      <input id="set-model" type="text" value="${escapeHtml(s.llm_model || "")}" placeholder="qwen2.5:7b">
      <div class="mu">Ключ, если сервер его требует</div>
      <input id="set-key" type="password" value="" placeholder="${escapeHtml(keyPlaceholder)}" autocomplete="new-password">
      <div class="row" style="flex-wrap:wrap">
        <button type="button" class="b" id="set-focus">Открыть в графе ComfyUI</button>
        <button type="button" class="b" id="set-layout">Сбросить раскладку</button>
      </div>
      <div class="dl-models">
        <div class="dl-head">Модели и загрузки</div>
        <div class="mu">Рекомендуемые файлы. Это справка, не проверка: подойдут другие версии, файнтюны и свои модели. «Установлен» значит, что это имя уже есть в каталоге.</div>
        <div id="dl-models-list">${modelDownloadsHtml()}</div>
        <button type="button" class="b s" id="set-rescan">Проверить снова</button>
      </div>`, async (box, close) => {
      box.classList.add("wide");
      box.querySelector("#set-focus").onclick = () => focusGraph();
      box.querySelector("#set-layout").onclick = () => { resetLayout(); close(); };
      box.querySelector("#set-rescan").onclick = () => rescanModels().then(() => {
        const list = box.querySelector("#dl-models-list");
        if (list) list.innerHTML = modelDownloadsHtml();
      });
      box.querySelector("[data-ok]").onclick = async () => {
        state.settings = await api("/zeroimagestudio/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          civitai_token: $("set-civ").value, llm_base: $("set-base").value, llm_model: $("set-model").value, llm_key: $("set-key").value,
        }) });
        close();
        toast("Настройки сохранены в user/zeroimagestudio/settings.json");
      };
    });
  }

  function openSystem() {
    const systems = (state.settings && state.settings.llm_systems) || {};
    openModal(`<h3>Системные промты</h3>
      <div class="mu">Улучшить</div><textarea id="sys-improve">${escapeHtml(systems.improve || "")}</textarea>
      <div class="mu">Дописать</div><textarea id="sys-extend">${escapeHtml(systems.extend || "")}</textarea>
      <div class="mu">Описать изображение</div><textarea id="sys-describe">${escapeHtml(systems.describe || "")}</textarea>
      <div class="mu">Сохранить как пресет режима</div><input id="sys-name" type="text" placeholder="Портрет">`, async (box, close) => {
      box.querySelector("[data-ok]").onclick = async () => {
        const llm_systems = { improve: $("sys-improve").value, extend: $("sys-extend").value, describe: $("sys-describe").value };
        const presets = (state.settings && state.settings.llm_presets) || [];
        const name = $("sys-name").value.trim();
        if (name) presets.unshift({ id: "llm" + Date.now(), name, systems: llm_systems });
        state.settings = await api("/zeroimagestudio/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ llm_systems, llm_presets: presets }) });
        fillLlmPresets();
        close();
      };
    });
  }

  function fillLlmPresets() {
    const sel = $("llm-preset");
    const items = (state.settings && state.settings.llm_presets) || [];
    sel.innerHTML = `<option value="">Режим: текущий</option>` + items.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  }

  function openCanvasSize() {
    const curW = editor.doc.w, curH = editor.doc.h;
    openModal(`<h3>Размер холста</h3>
      <div id="canvas-res">${resolutionPickerHtml(curW, curH)}</div>
      <div class="mu">Новый холст очищает слои. «Применить» меняет только размер документа. Генерация всего холста берёт этот размер, кратно 16.</div>
      <button class="b" id="cw-new" type="button">Новый пустой холст</button>`, (box, close) => {
      box.classList.add("wide");
      let picked = { w: snapSize(curW), h: snapSize(curH) };
      const paint = () => {
        const host = $("canvas-res");
        if (!host) return;
        host.innerHTML = resolutionPickerHtml(picked.w, picked.h);
        bindResolutionPicker(host.querySelector(".res-pick"), (w, h) => { picked = { w, h }; paint(); });
      };
      paint();
      const applySize = (blank) => {
        const root = box.querySelector(".res-pick");
        if (root) {
          picked = {
            w: snapSize(parseInt(root.querySelector("[data-rw]").value, 10) || picked.w),
            h: snapSize(parseInt(root.querySelector("[data-rh]").value, 10) || picked.h),
          };
        }
        if (blank) newCanvas(picked.w, picked.h);
        else {
          editor.pushUndo(editor.fullSnapshot());
          editor.doc = { w: picked.w, h: picked.h };
          editor.resizeMask();
          editor.gen.w = Math.min(editor.gen.w, picked.w);
          editor.gen.h = Math.min(editor.gen.h, picked.h);
          state.area.outputLinked = true;
          if (!state.area.userPlaced) syncDefaultArea();
          editor.fit();
          renderInspector();
          renderPipe();
          paintStatus();
        }
        close();
      };
      box.querySelector("[data-ok]").textContent = "Применить";
      box.querySelector("[data-ok]").onclick = () => applySize(false);
      $("cw-new").onclick = () => applySize(true);
    });
  }

  const presetUi = { filter: "all", query: "", sort: "name" };
  const PRESET_CATS_KEY = "zeroimagestudio.presetCats";

  function extraPresetCats() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRESET_CATS_KEY) || "[]");
      return Array.isArray(raw) ? raw.map((c) => String(c || "").trim()).filter(Boolean) : [];
    } catch { return []; }
  }

  function storeExtraCats(list) {
    try { localStorage.setItem(PRESET_CATS_KEY, JSON.stringify([...new Set(list)])); } catch { /* private mode */ }
  }

  function latestGalleryThumb() {
    const it = (state.gallery || []).find((g) => g && g.file && !g.example);
    if (!it) return "";
    const file = String(it.file).split("/").pop();
    return "/view?filename=" + encodeURIComponent(file) + "&type=output&subfolder=zeroimagestudio/gallery";
  }

  function genLoraCount(p) {
    const pipe = p && (p.pipeline === "create" ? p.create : p.edit);
    return ((pipe && pipe.loras) || []).filter((l) => l && l.enabled !== false && l.role !== "task" && !l.system).length;
  }

  function genSummary(p) {
    const hint = (state.hints || []).find((h) => h.id === p.hintId);
    const model = (hint && hint.name) || p.hintId || "Текущая модель";
    const s = p.sampler || {};
    const steps = s.steps != null ? s.steps : "—";
    const cfg = s.cfg != null ? s.cfg : "—";
    return { model, line: (s.sampler || "euler") + " · " + steps + " / " + cfg, loras: genLoraCount(p) };
  }

  function presetEntries() {
    const prompts = state.promptPresets.map((p) => ({
      kind: "prompt", id: p.id, name: p.name || "Пресет", category: U.presetCategory(p),
      favorite: !!p.favorite, updated: Number(p.updated) || 0, raw: p,
    }));
    const gens = state.presets.map((p) => ({
      kind: "gen", id: p.id, name: p.name || "Пресет", category: U.presetCategory(p),
      favorite: !!p.favorite, updated: Number(p.updated) || 0, raw: p,
    }));
    return [...gens, ...prompts];
  }

  function visiblePresets() {
    const q = presetUi.query.trim().toLowerCase();
    let list = presetEntries().filter((item) => {
      if (presetUi.filter === "gen" && item.kind !== "gen") return false;
      if (presetUi.filter === "prompt" && item.kind !== "prompt") return false;
      if (presetUi.filter === "fav" && !item.favorite) return false;
      if (presetUi.filter.startsWith("cat:") && item.category !== presetUi.filter.slice(4)) return false;
      if (!q) return true;
      const summary = item.kind === "gen" ? genSummary(item.raw).model : (item.raw.text || "");
      return (item.name + " " + item.category + " " + summary).toLowerCase().includes(q);
    });
    list.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      if (presetUi.sort === "new") return (b.updated - a.updated) || a.name.localeCompare(b.name, "ru");
      return a.name.localeCompare(b.name, "ru");
    });
    return list;
  }

  function presetCategories() {
    const set = new Set(extraPresetCats());
    presetEntries().forEach((item) => set.add(item.category));
    return [...set].sort((a, b) => a.localeCompare(b, "ru"));
  }

  function renderPresetPage() {
    const host = $("preset-page");
    if (!host) return;
    if (!host.dataset.ready) {
      host.dataset.ready = "1";
      host.innerHTML = `<div class="preset-mgr">
        <aside class="preset-side" id="preset-side"></aside>
        <div class="preset-main">
          <div class="preset-bar">
            <input id="preset-search" class="f" placeholder="Поиск по имени, категории, тексту" style="font-family:inherit">
            <select id="preset-sort" class="dd" title="Сортировка">
              <option value="name">По имени</option>
              <option value="new">Сначала новые</option>
            </select>
            <button type="button" class="b ac" id="preset-new" data-i="plus" data-s="13">Новый пресет</button>
          </div>
          <div class="preset-grid" id="preset-grid"></div>
        </div>
        <aside class="preset-drawer" id="preset-drawer" hidden></aside>
      </div>`;
      $("preset-search").addEventListener("input", () => {
        presetUi.query = $("preset-search").value;
        const pos = $("preset-search").selectionStart;
        paintPresetGrid();
        const again = $("preset-search");
        if (again) { again.focus(); again.setSelectionRange(pos, pos); }
      });
      $("preset-sort").onchange = () => { presetUi.sort = $("preset-sort").value; paintPresetGrid(); };
      host.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && e.target && e.target.id === "preset-newcat") {
          e.preventDefault();
          const btn = $("preset-addcat");
          if (btn) btn.click();
        }
      });
    }
    const search = $("preset-search");
    if (search && search.value !== presetUi.query) search.value = presetUi.query;
    const sort = $("preset-sort");
    if (sort) sort.value = presetUi.sort === "new" ? "new" : "name";
    paintPresetSide();
    paintPresetGrid();
    const badge = $("preset-count");
    if (badge) badge.textContent = String(state.presets.length + state.promptPresets.length);
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
  }

  function paintPresetSide() {
    const host = $("preset-side");
    if (!host) return;
    const all = presetEntries();
    const filters = [
      ["all", "Все", all.length],
      ["gen", "Генерация", all.filter((i) => i.kind === "gen").length],
      ["prompt", "Промт", all.filter((i) => i.kind === "prompt").length],
      ["fav", "Избранное", all.filter((i) => i.favorite).length],
    ];
    const cats = presetCategories();
    host.innerHTML = filters.map(([id, label, n]) =>
      `<button type="button" class="nav ${presetUi.filter === id ? "on" : ""}" data-preset-filter="${id}"><span>${label}</span><span class="c">${n}</span></button>`
    ).join("") + `<div class="lbl">Категории</div><div class="preset-cats">${cats.map((name) => {
      const n = all.filter((i) => i.category === name).length;
      const on = presetUi.filter === "cat:" + name;
      return `<div class="preset-cat">
        <button type="button" class="nav ${on ? "on" : ""}" data-preset-filter="${escapeHtml("cat:" + name)}"><span class="nm">${escapeHtml(name)}</span><span class="c">${n}</span></button>
        <button type="button" class="mini" data-cat-rename="${escapeHtml(name)}" title="Переименовать">✎</button>
        <button type="button" class="mini" data-cat-del="${escapeHtml(name)}" title="Удалить категорию">×</button>
      </div>`;
    }).join("") || `<div class="mu" style="padding:4px 6px">Пока только «Общее».</div>`}</div>
      <div class="preset-addcat"><input id="preset-newcat" class="f" placeholder="Новая категория" style="font-family:inherit"><button type="button" class="b s" id="preset-addcat">+</button></div>`;
  }

  function paintPresetGrid() {
    const host = $("preset-grid");
    if (!host) return;
    const list = visiblePresets();
    if (!list.length) {
      host.innerHTML = `<div class="preset-empty"><b>${presetUi.query ? "Ничего не найдено" : "Здесь будут пресеты"}</b><div>${presetUi.query ? "Смените запрос или категорию." : "Сниппеты промта и снимки настроек генерации лежат карточками."}</div><button type="button" class="b ac" data-preset-new="1">+ Новый пресет</button></div>`;
      return;
    }
    host.innerHTML = list.map((item) => {
      const id = escapeHtml(item.id);
      const kind = item.kind;
      let body = "";
      if (kind === "prompt") {
        const pos = item.raw.position === "after" ? "ПОСЛЕ" : "ДО";
        body = `<div class="meta"><span class="chip">${escapeHtml(item.category)}</span><span class="chip pos">${pos}</span></div><p class="preview">${escapeHtml(item.raw.text || "Пустой текст")}</p>`;
      } else {
        const sum = genSummary(item.raw);
        const shot = item.raw.thumb ? `<img class="shot" src="${escapeHtml(item.raw.thumb)}" alt="">` : "";
        body = `${shot}<div class="meta"><span class="chip">${escapeHtml(item.category)}</span><span class="chip">генерация</span></div><p class="preview">${escapeHtml(sum.model)} · ${escapeHtml(sum.line)} · LoRA ${sum.loras}</p>`;
      }
      return `<article class="preset-card ${item.favorite ? "fav" : ""}">
        <div class="top"><h3>${escapeHtml(item.name)}</h3><button type="button" class="star ${item.favorite ? "on" : ""}" data-preset-fav="${id}" data-preset-kind="${kind}" data-i="star" data-s="14" title="В избранное"></button></div>
        ${body}
        <div class="acts">
          <button type="button" class="b apply" data-preset-apply="${id}" data-preset-kind="${kind}">Применить</button>
          <button type="button" class="ic" data-preset-edit="${id}" data-preset-kind="${kind}" data-i="pen" data-s="13" title="Изменить"></button>
          <button type="button" class="ic" data-preset-dup="${id}" data-preset-kind="${kind}" data-i="layers" data-s="13" title="Дублировать"></button>
          <button type="button" class="ic" data-preset-del="${id}" data-preset-kind="${kind}" data-i="trash" data-s="13" title="Удалить"></button>
        </div>
      </article>`;
    }).join("");
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
  }

  function findPreset(kind, id) {
    const list = kind === "gen" ? state.presets : state.promptPresets;
    return list.find((p) => p.id === id) || null;
  }

  function openPresetDrawer(kind, id) {
    const drawer = $("preset-drawer");
    if (!drawer) return;
    const existing = id ? findPreset(kind, id) : null;
    const isNew = !existing;
    const useKind = existing ? kind : (kind || "prompt");
    drawer.hidden = false;
    drawer.dataset.kind = useKind;
    drawer.dataset.id = existing ? existing.id : "";
    const cats = presetCategories();
    const cat = existing ? U.presetCategory(existing) : (presetUi.filter.startsWith("cat:") ? presetUi.filter.slice(4) : "Общее");
    const options = [...new Set([cat, ...cats, "Общее"])].map((name) =>
      `<option value="${escapeHtml(name)}" ${name === cat ? "selected" : ""}>${escapeHtml(name)}</option>`
    ).join("");
    const promptFields = `<label>Позиция<select id="pd-pos" class="dd"><option value="before" ${!existing || existing.position !== "after" ? "selected" : ""}>ДО промта</option><option value="after" ${existing && existing.position === "after" ? "selected" : ""}>ПОСЛЕ промта</option></select></label>
      <label>Текст<textarea id="pd-text">${escapeHtml(existing ? existing.text : "")}</textarea></label>`;
    const sum = existing && useKind === "gen" ? genSummary(existing) : null;
    const genFields = `<div class="preset-facts"><div><span>Модель</span><b>${escapeHtml(sum ? sum.model : "текущая")}</b></div><div><span>Сэмплер</span><b>${escapeHtml(sum ? sum.line : "из холста")}</b></div><div><span>LoRA</span><b>${sum ? sum.loras : "из стека"}</b></div></div>
      <p class="mu">${isNew ? "Новый пресет снимет модель, LoRA, сэмплер и область. Холст не входит." : "Поля ниже меняют карточку. Снимок настроек обновляется отдельной кнопкой."}</p>
      ${isNew ? "" : `<button type="button" class="b" id="pd-recapture">Обновить из текущих настроек</button>`}`;
    drawer.innerHTML = `<h3>${isNew ? "Новый пресет" : "Изменить пресет"}</h3>
      ${isNew ? `<div class="preset-kind" id="pd-kind"><button type="button" data-pd-kind="prompt" class="${useKind === "prompt" ? "on" : ""}">Промт</button><button type="button" data-pd-kind="gen" class="${useKind === "gen" ? "on" : ""}">Генерация</button></div>` : `<div class="mu">${useKind === "gen" ? "Пресет генерации" : "Сниппет промта"}</div>`}
      <label>Имя<input id="pd-name" class="f" style="font-family:inherit" value="${escapeHtml(existing ? existing.name : "")}"></label>
      <label>Категория<select id="pd-cat" class="dd">${options}</select></label>
      <label>Или новая<input id="pd-cat-new" class="f" style="font-family:inherit" placeholder="Портрет, Стиль, Кожа…"></label>
      <label class="row" style="flex-direction:row;align-items:center"><input id="pd-fav" type="checkbox" ${existing && existing.favorite ? "checked" : ""}> В избранном</label>
      <div id="pd-body">${useKind === "gen" ? genFields : promptFields}</div>
      <div class="row"><button type="button" class="b ac" id="pd-save">Сохранить</button><button type="button" class="b" id="pd-cancel">Отмена</button></div>`;
    drawer.querySelectorAll("[data-pd-kind]").forEach((btn) => {
      btn.onclick = () => openPresetDrawer(btn.dataset.pdKind, "");
    });
  }

  function closePresetDrawer() {
    const drawer = $("preset-drawer");
    if (drawer) { drawer.hidden = true; drawer.innerHTML = ""; }
  }

  function drawerCategory() {
    const typed = ($("pd-cat-new") && $("pd-cat-new").value.trim()) || "";
    return typed || ($("pd-cat") && $("pd-cat").value) || "Общее";
  }

  async function persistGenPreset(p) {
    try {
      const saved = await api("/zeroimagestudio/collection/presets", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
      });
      if (saved && saved.id) p.id = saved.id;
      if (saved && saved.updated) p.updated = saved.updated;
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  function captureGenPreset(name, category, favorite, previous) {
    return {
      id: previous && previous.id,
      name,
      category: category || "Общее",
      favorite: !!favorite,
      thumb: (previous && previous.thumb) || latestGalleryThumb(),
      pipeline: state.pipeline,
      hintId: state.hintId,
      prompt: state.prompt,
      negative: state.negative,
      promptPresets: state.promptPresets,
      sampler: state.sampler,
      create: state.create,
      edit: state.edit,
      area: state.area,
      updated: Date.now(),
    };
  }

  async function savePresetDrawer() {
    const drawer = $("preset-drawer");
    if (!drawer || drawer.hidden) return;
    const kind = drawer.dataset.kind === "gen" ? "gen" : "prompt";
    const id = drawer.dataset.id || "";
    const name = ($("pd-name").value || "").trim();
    if (!name) { toast("У пресета нет имени."); return; }
    const category = drawerCategory();
    const favorite = !!($("pd-fav") && $("pd-fav").checked);
    storeExtraCats([...extraPresetCats(), category]);
    if (kind === "prompt") {
      const existing = id ? findPreset("prompt", id) : null;
      const draft = normalizePreset({
        id: existing && existing.id,
        name,
        category,
        text: $("pd-text") ? $("pd-text").value : "",
        position: $("pd-pos") ? $("pd-pos").value : "before",
        enabled: existing ? existing.enabled : false,
        favorite,
        order: existing ? existing.order : state.promptPresets.length,
      }, state.promptPresets.length);
      if (existing) Object.assign(existing, draft);
      else state.promptPresets.push(draft);
      await persistPreset(existing || draft);
    } else if (id) {
      const existing = findPreset("gen", id);
      if (!existing) return;
      existing.name = name;
      existing.category = category;
      existing.favorite = favorite;
      await persistGenPreset(existing);
    } else {
      const previous = id ? findPreset("gen", id) : null;
      const draft = captureGenPreset(name, category, favorite, previous);
      if (previous) Object.assign(previous, draft);
      else state.presets.unshift(draft);
      await persistGenPreset(previous || draft);
    }
    closePresetDrawer();
    renderPresetSelect();
    renderPresetPage();
    renderChips();
  }

  async function applyPresetCard(kind, id) {
    if (kind === "gen") {
      const p = findPreset("gen", id);
      if (!p) return;
      applyPreset(p);
      document.querySelector('.tabs [data-tab="canvas"]').click();
      return;
    }
    const p = findPreset("prompt", id);
    if (!p) return;
    p.enabled = true;
    p.order = Math.max(-1, ...state.promptPresets.map((x) => Number(x.order) || 0)) + 1;
    await persistPreset(p);
    renderChips();
    toast("Пресет «" + p.name + "» включён в промт.");
    document.querySelector('.tabs [data-tab="canvas"]').click();
  }

  async function duplicatePresetCard(kind, id) {
    const src = findPreset(kind, id);
    if (!src) return;
    if (kind === "prompt") {
      const copy = normalizePreset({ ...src, id: undefined, name: src.name + " копия", enabled: false, favorite: false, order: state.promptPresets.length }, state.promptPresets.length);
      state.promptPresets.push(copy);
      await persistPreset(copy);
    } else {
      const copy = { ...JSON.parse(JSON.stringify(src)), id: "g" + Math.random().toString(36).slice(2, 8), name: (src.name || "Пресет") + " копия", favorite: false, updated: Date.now() };
      state.presets.unshift(copy);
      await persistGenPreset(copy);
    }
    renderPresetSelect();
    renderPresetPage();
  }

  async function deletePresetCard(kind, id) {
    const src = findPreset(kind, id);
    if (!src) return;
    if (!window.confirm("Удалить пресет «" + (src.name || "") + "»?")) return;
    const path = kind === "gen" ? "/zeroimagestudio/collection/presets/" : "/zeroimagestudio/collection/prompt_presets/";
    try { await api(path + encodeURIComponent(id), { method: "DELETE" }); }
    catch (err) { toast(err.message || String(err)); }
    if (kind === "gen") state.presets = state.presets.filter((p) => p.id !== id);
    else state.promptPresets = state.promptPresets.filter((p) => p.id !== id);
    renderPresetSelect();
    renderChips();
    renderPresetPage();
  }

  async function togglePresetFav(kind, id) {
    const src = findPreset(kind, id);
    if (!src) return;
    src.favorite = !src.favorite;
    if (kind === "prompt") await persistPreset(src);
    else await persistGenPreset(src);
    renderPresetPage();
  }

  async function renamePresetCategory(name) {
    const next = window.prompt("Новое имя категории", name);
    if (!next || !next.trim() || next.trim() === name) return;
    const label = next.trim();
    const changedP = [];
    const changedG = [];
    state.promptPresets.forEach((p) => { if (U.presetCategory(p) === name) { p.category = label; changedP.push(p); } });
    state.presets.forEach((p) => { if (U.presetCategory(p) === name) { p.category = label; changedG.push(p); } });
    storeExtraCats(extraPresetCats().map((c) => (c === name ? label : c)));
    if (presetUi.filter === "cat:" + name) presetUi.filter = "cat:" + label;
    await Promise.all(changedP.map((p) => persistPreset(p)));
    await Promise.all(changedG.map((p) => persistGenPreset(p)));
    renderPresetPage();
  }

  async function deletePresetCategory(name) {
    if (!window.confirm("Удалить категорию «" + name + "»? Пресеты перейдут в «Общее».")) return;
    const changedP = [];
    const changedG = [];
    state.promptPresets.forEach((p) => { if (U.presetCategory(p) === name) { p.category = "Общее"; changedP.push(p); } });
    state.presets.forEach((p) => { if (U.presetCategory(p) === name) { p.category = "Общее"; changedG.push(p); } });
    storeExtraCats(extraPresetCats().filter((c) => c !== name));
    if (presetUi.filter === "cat:" + name) presetUi.filter = "all";
    await Promise.all(changedP.map((p) => persistPreset(p)));
    await Promise.all(changedG.map((p) => persistGenPreset(p)));
    renderPresetPage();
  }

  let menuName = null;
  let menuIndex = 0;
  let altDown = false;
  let altUsed = false;

  function menuRoot() {
    return menuName ? document.querySelector(`.menu[data-menu="${menuName}"]`) : null;
  }

  function menuItems() {
    const root = menuRoot();
    if (!root) return [];
    return [...root.querySelectorAll("[role='menuitem'], [role='menuitemcheckbox']")];
  }

  function paintMenuIndex() {
    menuItems().forEach((el, i) => el.classList.toggle("on", i === menuIndex));
  }

  function closeMenus() {
    menuName = null;
    menuIndex = 0;
    document.querySelectorAll(".menu-pop").forEach((pop) => { pop.hidden = true; });
    document.querySelectorAll(".menu-btn").forEach((btn) => btn.setAttribute("aria-expanded", "false"));
  }

  function renderRecent() {
    const host = $("recent-projects");
    if (!host) return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { list = []; }
    if (!Array.isArray(list) || !list.length) {
      host.innerHTML = `<div class="menu-label">нет</div>`;
      return;
    }
    host.innerHTML = list.slice(0, 8).map((p) =>
      `<button type="button" role="menuitem" data-act="recent" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name || "Проект")}</button>`
    ).join("");
  }

  function rememberProject(id, name) {
    if (!id) return;
    let list = [];
    try { list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]"); } catch { list = []; }
    if (!Array.isArray(list)) list = [];
    list = [{ id, name: name || "Проект" }, ...list.filter((p) => p && p.id !== id)].slice(0, 8);
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch { /* private mode */ }
    renderRecent();
  }

  function renderViewPanels() {
    const host = $("view-panels");
    if (!host) return;
    const hidden = (state.layout && state.layout.hidden) || {};
    host.innerHTML = Object.entries(PANEL_LABELS).map(([id, name]) => {
      const on = !hidden[id];
      return `<button type="button" role="menuitemcheckbox" aria-checked="${on ? "true" : "false"}" data-act="panel" data-toggle="${id}">${on ? "✓ " : ""}${name}</button>`;
    }).join("");
  }

  function openMenu(name, focus) {
    closeMenus();
    const root = document.querySelector(`.menu[data-menu="${name}"]`);
    if (!root) return;
    if (name === "file") renderRecent();
    if (name === "view") renderViewPanels();
    menuName = name;
    const pop = root.querySelector(".menu-pop");
    pop.hidden = false;
    root.querySelector(".menu-btn").setAttribute("aria-expanded", "true");
    menuIndex = 0;
    paintMenuIndex();
    if (focus) {
      const btn = root.querySelector(".menu-btn");
      if (btn) btn.focus();
    }
  }

  function moveMenu(delta) {
    const names = [...document.querySelectorAll(".menu")].map((el) => el.dataset.menu);
    const at = Math.max(0, names.indexOf(menuName));
    openMenu(names[(at + delta + names.length) % names.length], true);
  }

  function moveItem(delta) {
    const items = menuItems();
    if (!items.length) return;
    menuIndex = (menuIndex + delta + items.length) % items.length;
    paintMenuIndex();
  }

  function activateMenuItem(item) {
    if (!item) return;
    const act = item.dataset.act;
    if (act !== "panel") closeMenus();
    runMenuAction(act, item);
  }

  function toggleHiddenPanel(id) {
    if (!state.layout || !PANEL_LABELS[id]) return;
    state.layout.hidden = state.layout.hidden || {};
    if (state.layout.hidden[id]) delete state.layout.hidden[id];
    else state.layout.hidden[id] = true;
    applyLayout(state.layout);
    saveLayout();
    renderViewPanels();
    if (menuName === "view") {
      const items = menuItems();
      const at = items.findIndex((el) => el.dataset.toggle === id);
      if (at >= 0) menuIndex = at;
      paintMenuIndex();
    }
  }

  function newProject() {
    if (state.dirty && !window.confirm("Есть несохранённые правки. Начать новый проект?")) return;
    state.projectId = null;
    state.projectName = "Новый проект";
    state.prompt = "";
    state.negative = "";
    if ($("prompt")) $("prompt").value = "";
    if ($("negative")) $("negative").value = "";
    fitPromptField();
    newCanvas(1024, 1024);
    editor.clearHistory();
    state.dirty = false;
    $("project-name").value = state.projectName;
    $("project-sub").textContent = "новый проект";
    updateFinal();
    updateGenerateButton();
  }

  async function saveProjectAs() {
    const name = window.prompt("Имя проекта", state.projectName || "Новый проект");
    if (!name) return;
    state.projectName = name;
    $("project-name").value = name;
    state.projectId = null;
    try {
      const id = await saveProject();
      const a = document.createElement("a");
      a.href = "/zeroimagestudio/project/" + id + "/export";
      a.download = name + ".zip";
      a.click();
      toast("Проект сохранён и скачан.");
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  function exportPng() {
    const a = document.createElement("a");
    a.href = editor.flatten().toDataURL("image/png");
    a.download = (state.projectName || "zeroimagestudio") + ".png";
    a.click();
  }

  function runMenuAction(act, item) {
    if (act === "new") newProject();
    else if (act === "open-project") $("file-open").click();
    else if (act === "open-image") $("file-layer").click();
    else if (act === "save") saveProject().then(() => toast("Проект сохранён.")).catch((err) => toast(err.message || String(err)));
    else if (act === "save-as") saveProjectAs();
    else if (act === "export-png") exportPng();
    else if (act === "recent") loadProject(item.dataset.id).then(() => toast("Проект загружен.")).catch((err) => toast(err.message || String(err)));
    else if (act === "undo") editor.undo();
    else if (act === "redo") editor.redo();
    else if (act === "canvas-size") openCanvasSize();
    else if (act === "fit-canvas") fitCanvasToContent("all");
    else if (act === "fit") editor.fit();
    else if (act === "zoom100") editor.zoom100();
    else if (act === "reset-layout") resetLayout();
    else if (act === "settings") openSettings();
    else if (act === "focus-graph") focusGraph();
    else if (act === "help") toggleHelp(true);
    else if (act === "panel") toggleHiddenPanel(item.dataset.toggle);
  }

  function typingTarget(target) {
    const tag = ((target && target.tagName) || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || (target && target.isContentEditable);
  }

  function onMenuKey(e) {
    if (e.key === "Alt") {
      if (typingTarget(e.target)) return;
      e.preventDefault();
      altDown = true;
      return;
    }
    if (e.altKey && !e.ctrlKey && !e.metaKey && !typingTarget(e.target) && !e.repeat) {
      const key = e.key.toLowerCase();
      const map = { f: "file", ф: "file", e: "edit", p: "edit", п: "edit", v: "view", в: "view", n: "settings", н: "settings", h: "help", с: "help" };
      if (map[key]) {
        e.preventDefault();
        altUsed = true;
        openMenu(map[key], true);
        return;
      }
    }
    if (!menuName) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeMenus();
      return;
    }
    if (e.key === "ArrowRight") { e.preventDefault(); e.stopPropagation(); moveMenu(1); return; }
    if (e.key === "ArrowLeft") { e.preventDefault(); e.stopPropagation(); moveMenu(-1); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); moveItem(1); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); moveItem(-1); return; }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.stopPropagation();
      activateMenuItem(menuItems()[menuIndex]);
      return;
    }
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  function onMenuKeyUp(e) {
    if (e.key !== "Alt") return;
    if (altDown && !altUsed && !typingTarget(e.target)) {
      if (menuName) closeMenus();
      else openMenu("file", true);
    }
    altDown = false;
    altUsed = false;
  }

  function bindMenus() {
    const bar = $("menubar");
    renderRecent();
    renderViewPanels();
    bar.addEventListener("click", (e) => {
      const top = e.target.closest(".menu-btn");
      if (top) {
        const name = top.parentElement.dataset.menu;
        if (menuName === name) closeMenus();
        else openMenu(name, false);
        return;
      }
      const item = e.target.closest("[data-act]");
      if (!item || !bar.contains(item)) return;
      activateMenuItem(item);
    });
    bar.addEventListener("pointerover", (e) => {
      if (!menuName) return;
      const menu = e.target.closest(".menu");
      if (menu && menu.dataset.menu !== menuName) openMenu(menu.dataset.menu, false);
    });
    document.addEventListener("pointerdown", (e) => {
      if (!menuName) return;
      if (e.target.closest("#menubar")) return;
      closeMenus();
    });
    window.addEventListener("keydown", onMenuKey, true);
    window.addEventListener("keyup", onMenuKeyUp, true);
    const model = $("model-node");
    model.addEventListener("click", (e) => {
      const task = e.target.closest("[data-krea-task]");
      if (task) { setKreaTask(task.dataset.kreaTask); return; }
      if (e.target.closest("[data-rescan]")) rescanModels();
    });
  }

  function bindStatic() {
    let storedPrompt = "compact";
    try { storedPrompt = localStorage.getItem(PROMPT_MODE_KEY) === "full" ? "full" : "compact"; } catch (err) { /* private mode */ }
    setPromptMode(storedPrompt, false);
    document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
      document.body.dataset.tab = b.dataset.tab;
      if (b.dataset.tab === "presets") renderPresetPage();
      if (b.dataset.tab === "lora" || b.dataset.tab === "canvas") renderLoras();
      if (b.dataset.tab === "canvas") requestAnimationFrame(() => editor.resizeView());
    });
    $("mode").onclick = (e) => {
      const b = e.target.closest("[data-pipe]");
      if (!b || b.dataset.pipe === state.pipeline) return;
      state.hintByMode[state.pipeline] = state.hintId;
      state.pipeline = b.dataset.pipe;
      const list = hintsForMode(state.pipeline);
      const remembered = canonicalHintId(state.hintByMode[state.pipeline]);
      const hint = list.find((h) => h.id === remembered) || list[0];
      if (hint) applyHint(hint);
      else renderAll();
    };
    $("model-toggle").onclick = () => {
      const node = $("model-node");
      const open = !node.classList.contains("open");
      node.classList.toggle("open", open);
      $("model-drawer").inert = !open;
      $("model-toggle").setAttribute("aria-expanded", open ? "true" : "false");
      try { localStorage.setItem("zeroimagestudio.modelDrawer", open ? "open" : "closed"); } catch (err) { /* private mode */ }
    };
    $("hint-list").onclick = (e) => {
      const b = e.target.closest("[data-hint]");
      if (!b) return;
      const h = state.hints.find((x) => x.id === b.dataset.hint);
      if (h) applyHint(h);
    };
    $("file-block").addEventListener("change", onFileChange);
    $("graph-options").addEventListener("change", onFileChange);
    $("tools").onclick = (e) => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); };
    $("swatch").oninput = () => { state.color = $("swatch").value; };
    $("prompt").oninput = () => { state.prompt = $("prompt").value; state.dirty = true; updateFinal(); updateGenerateButton(); fitPromptField(); if (isKreaEdit()) renderKreaChrome(); };
    $("prompt-fold").onclick = () => setPromptMode($("prompt-node").dataset.prompt === "full" ? "compact" : "full", true);
    $("negative").oninput = () => { state.negative = $("negative").value; };
    $("project-name").onchange = () => { state.projectName = $("project-name").value || "zeroimagestudio"; };
    $("btn-gen").onclick = () => generate();
    $("btn-collapse").onclick = () => collapseZeroImageStudio();
    $("btn-gen-full").onclick = () => useWholeCanvas();
    bindMenus();
    $("file-open").onchange = async () => {
      const file = $("file-open").files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      try {
        const data = await api("/zeroimagestudio/import_project", { method: "POST", body: fd });
        await loadProject(data.id);
        $("file-open").value = "";
        toast("Проект загружен.");
      } catch (err) { toast(err.message); }
    };
    $("btn-undo").onclick = () => editor.undo();
    $("btn-redo").onclick = () => editor.redo();
    $("btn-system").onclick = () => openSystem();
    $("btn-canvas-size").onclick = () => openCanvasSize();
    $("btn-canvas-fit").onclick = () => fitCanvasToContent("all");
    $("btn-open-image").onclick = () => $("file-layer").click();
    $("btn-help").onclick = () => toggleHelp();
    const stageMid = () => {
      const r = $("stage").getBoundingClientRect();
      return [r.left + r.width / 2, r.top + r.height / 2];
    };
    $("zoom-out").onclick = () => { const [x, y] = stageMid(); editor.zoomBy(1 / 1.15, x, y); };
    $("zoom-in").onclick = () => { const [x, y] = stageMid(); editor.zoomBy(1.15, x, y); };
    $("zoom-fit").onclick = () => editor.fit();
    $("zoom-100").onclick = () => editor.zoom100();
    $("zoom-readout").onclick = () => editor.fit();
    $("btn-cancel").onclick = () => { if (state.running) generate(); };
    window.addEventListener("beforeunload", (e) => {
      if (!state.dirty) return;
      e.preventDefault();
      e.returnValue = "";
    });
    setInterval(() => {
      if (state.studioPaused || !state.dirty || state.running) return;
      saveProject({ auto: true }).catch(() => {});
    }, 3 * 60 * 1000);
    const brushSize = $("brush-size");
    if (brushSize) brushSize.oninput = () => { state.brush.size = Number(brushSize.value) || 1; renderToolOptions(); };
    $("llm-improve").onclick = () => runLlm("improve");
    $("llm-extend").onclick = () => runLlm("extend");
    $("llm-describe").onclick = () => runLlm("describe");
    $("btn-save-preset").onclick = async () => {
      const name = window.prompt("Имя пресета", "Портрет HQ");
      if (!name) return;
      const item = await api("/zeroimagestudio/collection/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(
        captureGenPreset(name, "Общее", false, null)
      ) });
      state.presets.unshift(item);
      renderPresetSelect();
      toast("Пресет сохранён.");
    };
    $("preset-select").onchange = () => {
      const p = state.presets.find((x) => x.id === $("preset-select").value);
      if (p) applyPreset(p);
    };
    $("pp-open").onclick = () => { if ($("pp-pop").hidden) openPromptPop(); else closePromptPop(); };
    $("pp-chips").onclick = (e) => {
      if (e.target.closest("[data-pp-open]")) {
        if ($("prompt-node").dataset.prompt !== "full") setPromptMode("full", true);
        openPromptPop();
        return;
      }
      const off = e.target.closest("[data-pp-off]");
      if (!off) return;
      const p = state.promptPresets.find((x) => x.id === off.dataset.ppOff);
      if (!p) return;
      p.enabled = false;
      persistPreset(p);
      renderChips();
    };
    $("pp-create").onclick = () => openPresetForm(null);
    $("pp-cancel").onclick = () => { $("pp-form").hidden = true; ppEditingId = null; };
    $("pp-search").addEventListener("input", () => renderPromptMenu());
    $("pp-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = $("pp-name").value.trim();
      if (!name) { toast("У пресета нет имени."); return; }
      const existing = ppEditingId ? state.promptPresets.find((x) => x.id === ppEditingId) : null;
      const draft = normalizePreset({
        id: existing && existing.id,
        name,
        category: $("pp-cat").value.trim() || "Общее",
        text: $("pp-text").value,
        position: $("pp-pos").value,
        enabled: existing ? existing.enabled : false,
        order: existing ? existing.order : state.promptPresets.length,
      }, state.promptPresets.length);
      if (existing) Object.assign(existing, draft);
      else state.promptPresets.push(draft);
      await persistPreset(existing || draft);
      $("pp-form").hidden = true;
      ppEditingId = null;
      renderChips();
    });
    $("pp-list").addEventListener("change", (e) => {
      const box = e.target.closest("[data-pp-on]");
      if (!box) return;
      const p = state.promptPresets.find((x) => x.id === box.dataset.ppOn);
      if (!p) return;
      p.enabled = box.checked;
      if (p.enabled) p.order = Math.max(-1, ...state.promptPresets.map((x) => x.order)) + 1;
      persistPreset(p);
      renderChips();
    });
    $("pp-list").addEventListener("click", async (e) => {
      const id = (sel) => { const n = e.target.closest(sel); return n && Object.values(n.dataset)[0]; };
      const edit = e.target.closest("[data-pp-edit]");
      const pos = e.target.closest("[data-pp-pos]");
      const up = e.target.closest("[data-pp-up]");
      const down = e.target.closest("[data-pp-down]");
      const dup = e.target.closest("[data-pp-dup]");
      const del = e.target.closest("[data-pp-del]");
      const find = (node) => node && state.promptPresets.find((x) => x.id === Object.values(node.dataset)[0]);
      if (edit) { openPresetForm(find(edit)); return; }
      if (pos) {
        const p = find(pos);
        if (!p) return;
        p.position = p.position === "after" ? "before" : "after";
        await persistPreset(p);
        renderChips();
        return;
      }
      if (up || down) {
        const node = up || down;
        const active = activeOrdered();
        const i = active.findIndex((p) => p.id === Object.values(node.dataset)[0]);
        const j = i + (up ? -1 : 1);
        if (i < 0 || j < 0 || j >= active.length) return;
        const list = active.slice();
        const [item] = list.splice(i, 1);
        list.splice(j, 0, item);
        const changed = [];
        list.forEach((p, idx) => { if (p.order !== idx) { p.order = idx; changed.push(p); } });
        await Promise.all(changed.map((p) => persistPreset(p)));
        renderChips();
        return;
      }
      if (dup) {
        const p = find(dup);
        if (!p) return;
        const copy = normalizePreset({ ...p, id: undefined, name: p.name + " копия", enabled: false, order: state.promptPresets.length }, state.promptPresets.length);
        delete copy.id;
        state.promptPresets.push(copy);
        await persistPreset(copy);
        renderChips();
        return;
      }
      if (del) {
        const p = find(del);
        if (!p) return;
        if (!window.confirm("Удалить пресет «" + p.name + "»?")) return;
        try { await api("/zeroimagestudio/collection/prompt_presets/" + encodeURIComponent(p.id), { method: "DELETE" }); }
        catch (err) { toast(err.message || String(err)); }
        state.promptPresets = state.promptPresets.filter((x) => x.id !== p.id);
        renderChips();
      }
      void id;
    });
    document.addEventListener("click", (e) => {
      if ($("pp-pop").hidden) return;
      if (e.target.closest("#pp-pop") || e.target.closest("#pp-open") || e.target.closest("#pp-chips")) return;
      closePromptPop();
    });
    window.addEventListener("resize", () => { if (!$("pp-pop").hidden) placePromptPop(); });
    $("ref-list").onclick = async (e) => {
      if (e.target.closest("#ref-upload")) { $("file-ref").click(); return; }
      if (e.target.closest("#ref-from-layer")) {
        const layer = editor.activeLayer();
        if (!layer) return;
        const c = document.createElement("canvas");
        c.width = layer.canvas.width; c.height = layer.canvas.height;
        c.getContext("2d").drawImage(layer.canvas, 0, 0);
        state.references.push({ id: "r" + Date.now(), name: "#" + (state.references.length + 1), canvas: c, url: c.toDataURL("image/png") });
        renderRefs();
        canvasBlob(c).then((blob) => rememberAsset(new File([blob], layer.name + ".png", { type: "image/png" }), "reference", null)).catch((err) => toast(err.message || String(err)));
        return;
      }
      const del = e.target.closest("[data-ref-del]");
      if (del) { state.references = state.references.filter((r) => r.id !== del.dataset.refDel); renderRefs(); return; }
      const card = e.target.closest(".ref[data-ref]");
      if (card) {
        const ref = state.references.find((r) => r.id === card.dataset.ref);
        if (ref) { ref.selected = !ref.selected; renderRefs(); }
      }
    };
    $("file-ref").onchange = async () => {
      for (const file of $("file-ref").files) {
        const img = await loadImage(URL.createObjectURL(file));
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        state.references.push({ id: "r" + Math.random().toString(36).slice(2, 7), name: file.name || ("#" + (state.references.length + 1)), canvas: c, url: c.toDataURL("image/png") });
        try { await rememberAsset(file, "reference", null); }
        catch (err) { toast(err.message || String(err)); }
      }
      $("file-ref").value = "";
      renderRefs();
    };
    $("file-layer").onchange = async () => {
      const file = $("file-layer").files[0];
      $("file-layer").value = "";
      if (!file) return;
      const img = await loadImage(URL.createObjectURL(file));
      await offerImportImage(img, file.name, file);
    };
    const stage = $("stage");
    stage.addEventListener("dragenter", (e) => { e.preventDefault(); stage.classList.add("dropping"); });
    stage.addEventListener("dragover", (e) => { e.preventDefault(); stage.classList.add("dropping"); });
    stage.addEventListener("dragleave", (e) => { if (e.target === stage) stage.classList.remove("dropping"); });
    stage.addEventListener("drop", async (e) => {
      e.preventDefault();
      stage.classList.remove("dropping");
      const assetId = e.dataTransfer && e.dataTransfer.getData("text/zis-asset");
      if (assetId) { await openAssetOnCanvas(assetId); return; }
      const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      const img = await loadImage(URL.createObjectURL(files[0]));
      await offerImportImage(img, files[0].name, files[0]);
    });
    $("ref-list").addEventListener("dragover", (e) => {
      if (e.dataTransfer && [...e.dataTransfer.types].includes("text/zis-asset")) e.preventDefault();
    });
    $("ref-list").addEventListener("drop", async (e) => {
      const assetId = e.dataTransfer && e.dataTransfer.getData("text/zis-asset");
      if (!assetId) return;
      e.preventDefault();
      await addAssetAsReference(assetId);
    });
    window.addEventListener("paste", async (e) => {
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      const items = [...(e.clipboardData && e.clipboardData.items || [])];
      const file = items.map((item) => (item.kind === "file" ? item.getAsFile() : null)).find((f) => f && /^image\//.test(f.type));
      if (!file) return;
      e.preventDefault();
      const img = await loadImage(URL.createObjectURL(file));
      await offerImportImage(img, "Буфер обмена", file);
    });
    $("lora-panel").addEventListener("click", onLoraClick);
    $("lora-panel").addEventListener("change", onLoraChange);
    $("lora-panel").addEventListener("input", onLoraInput);
    let layerDrag = null;
    let suppressLayerClick = false;
    $("layer-list").addEventListener("pointerdown", (e) => {
      const row = e.target.closest("[data-layer]");
      if (!row || e.target.closest("button")) return;
      layerDrag = { id: row.dataset.layer, y: e.clientY };
    });
    window.addEventListener("pointerup", (e) => {
      if (!layerDrag) return;
      const start = layerDrag;
      layerDrag = null;
      if (Math.abs(e.clientY - start.y) < 14) return;
      const target = document.elementFromPoint(e.clientX, e.clientY);
      const row = target && target.closest ? target.closest("[data-layer]") : null;
      if (!row || row.dataset.layer === start.id) return;
      const from = editor.layers.findIndex((l) => l.id === start.id);
      const to = editor.layers.findIndex((l) => l.id === row.dataset.layer);
      if (from < 0 || to < 0) return;
      editor.pushUndo(editor.fullSnapshot());
      const [item] = editor.layers.splice(from, 1);
      editor.layers.splice(to, 0, item);
      editor.active = editor.layers.indexOf(item);
      suppressLayerClick = true;
      editor.requestDraw();
      renderLayers();
    });
    $("layer-list").onclick = (e) => {
      if (suppressLayerClick) { suppressLayerClick = false; return; }
      if (e.target.closest("[data-mask-eye]")) { editor.toggleWorkMask(); return; }
      if (e.target.closest("[data-mask-inv]")) { editor.invertWorkMask(); return; }
      if (e.target.closest("[data-mask-clear]")) { editor.clearWorkMask(); return; }
      if (e.target.closest("[data-mask-row]")) { editor.focusWorkMask(); return; }
      const eye = e.target.closest("[data-eye]");
      const lock = e.target.closest("[data-lock]");
      const lmask = e.target.closest("[data-lmask]");
      const row = e.target.closest("[data-layer]");
      if (eye) {
        const l = editor.layers.find((x) => x.id === eye.dataset.eye);
        if (l) { editor.pushUndo(editor.fullSnapshot()); l.visible = !l.visible; }
      } else if (lock) {
        const l = editor.layers.find((x) => x.id === lock.dataset.lock);
        if (l) { editor.pushUndo(editor.fullSnapshot()); l.locked = !l.locked; }
      } else if (lmask) {
        editor.active = editor.layers.findIndex((x) => x.id === lmask.dataset.lmask);
        state.maskFocus = { id: lmask.dataset.lmask };
        if (state.tool !== "brush" && state.tool !== "eraser") { setTool("brush"); return; }
      } else if (row) {
        state.maskFocus = null;
        editor.active = editor.layers.findIndex((x) => x.id === row.dataset.layer);
      } else return;
      editor.requestDraw();
      renderLayers();
    };
    $("layer-list").ondblclick = (e) => {
      const nameEl = e.target.closest(".n b");
      const row = e.target.closest("[data-layer]");
      if (!row || !nameEl) return;
      const l = editor.layers.find((x) => x.id === row.dataset.layer);
      if (!l) return;
      const input = document.createElement("input");
      input.className = "f";
      input.value = l.name;
      input.style.width = "100%";
      nameEl.replaceWith(input);
      input.focus();
      input.select();
      const commit = () => {
        const next = input.value.trim();
        if (next && next !== l.name) { editor.pushUndo(editor.fullSnapshot()); l.name = next; }
        renderLayers();
      };
      input.onkeydown = (ev) => {
        if (ev.key === "Enter") { ev.preventDefault(); input.blur(); }
        if (ev.key === "Escape") { input.onblur = null; renderLayers(); }
      };
      input.onblur = commit;
    };
    $("layer-list").addEventListener("contextmenu", (e) => {
      const maskRow = e.target.closest("[data-mask-row]");
      if (maskRow) {
        e.preventDefault();
        state.maskFocus = "work";
        renderLayers();
        openWorkMaskMenu(e.clientX, e.clientY);
        return;
      }
      const row = e.target.closest("[data-layer]");
      if (!row) return;
      e.preventDefault();
      editor.active = editor.layers.findIndex((x) => x.id === row.dataset.layer);
      if (e.target.closest("[data-lmask]")) state.maskFocus = { id: row.dataset.layer };
      else if (state.maskFocus === "work") state.maskFocus = null;
      renderLayers();
      openLayerMenu(e.clientX, e.clientY);
    });
    $("btn-layer-add").onclick = () => {
      editor.pushUndo(editor.fullSnapshot());
      const layer = editor.makeLayer("Слой " + (editor.layers.length + 1));
      layer.canvas.width = editor.doc.w; layer.canvas.height = editor.doc.h;
      editor.addLayer(layer);
    };
    $("btn-layer-dup").onclick = () => {
      const l = editor.activeLayer(); if (!l) return;
      editor.pushUndo(editor.fullSnapshot());
      const c = document.createElement("canvas");
      c.width = l.canvas.width; c.height = l.canvas.height;
      c.getContext("2d").drawImage(l.canvas, 0, 0);
      const copy = editor.makeLayer(l.name + " копия", c);
      copy.x = l.x + 16; copy.y = l.y + 16; copy.blend = l.blend; copy.opacity = l.opacity;
      editor.copyMask(l, copy);
      editor.addLayer(copy);
    };
    $("btn-layer-del").onclick = () => editor.deleteActive();
    $("gal").onclick = async (e) => {
      const genBtn = e.target.closest("[data-gal-apply], [data-gal-seed], [data-gal-lora]");
      if (genBtn) {
        const id = genBtn.dataset.galApply || genBtn.dataset.galSeed || genBtn.dataset.galLora;
        const it = state.gallery.find((x) => x.id === id);
        if (!it) return;
        if (genBtn.dataset.galApply) useGalleryMeta(it, "apply");
        else if (genBtn.dataset.galSeed) useGalleryMeta(it, "seed");
        else useGalleryMeta(it, "lora");
        return;
      }
      const assetBtn = e.target.closest("[data-asset-open], [data-asset-ref], [data-asset-del]");
      if (assetBtn) {
        const id = assetBtn.dataset.assetOpen || assetBtn.dataset.assetRef || assetBtn.dataset.assetDel;
        try {
          if (assetBtn.dataset.assetOpen) await openAssetOnCanvas(id);
          else if (assetBtn.dataset.assetRef) await addAssetAsReference(id);
          else await deleteAsset(id);
        } catch (err) { toast(err.message || String(err)); }
        return;
      }
      const ex = e.target.closest("[data-example]");
      if (ex) { toast("Это пример оформления, не результат генерации."); return; }
      const b = e.target.closest("[data-gal]");
      if (!b) return;
      const it = state.gallery.find((x) => x.id === b.dataset.gal);
      if (it) showPop(it, b);
    };
    $("gal").addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target.closest(".tile-actions")) return;
      const tile = e.target.closest("[data-gal]");
      if (!tile) return;
      e.preventDefault();
      tile.click();
    });
    $("gal").addEventListener("dragstart", (e) => {
      const card = e.target.closest("[data-asset]");
      if (!card) return;
      e.dataTransfer.setData("text/zis-asset", card.dataset.asset);
      e.dataTransfer.effectAllowed = "copy";
    });
    $("gal").addEventListener("contextmenu", (e) => {
      const card = e.target.closest("[data-asset]");
      if (!card) return;
      e.preventDefault();
      openAssetMenu(e.clientX, e.clientY, card.dataset.asset);
    });
    $("gal-kind").onclick = (e) => {
      const b = e.target.closest("[data-kind]");
      if (!b || b.dataset.kind === state.galleryKind) return;
      state.galleryKind = b.dataset.kind === "assets" ? "assets" : "gens";
      renderGallery();
    };
    $("gal-scope").onclick = (e) => {
      const b = e.target.closest("[data-scope]");
      if (!b || b.dataset.scope === state.galleryScope) return;
      state.galleryScope = b.dataset.scope === "project" ? "project" : "all";
      renderGallery();
    };
    $("gal-model").onchange = renderGallery;
    $("gal-lora").onchange = renderGallery;
    $("gal-sort").onchange = () => { $("gal-sort-label").textContent = "сортировка: " + ($("gal-sort").value === "old" ? "старые" : "новые"); renderGallery(); };
    document.addEventListener("click", (e) => { if (!$("pop").hidden && !e.target.closest("#pop") && !e.target.closest("[data-gal]")) $("pop").hidden = true; });
    $("preset-page").addEventListener("click", async (e) => {
      const filter = e.target.closest("[data-preset-filter]");
      if (filter) { presetUi.filter = filter.dataset.presetFilter; paintPresetSide(); paintPresetGrid(); return; }
      if (e.target.closest("#preset-addcat")) {
        const input = $("preset-newcat");
        const name = input && input.value.trim();
        if (!name) return;
        storeExtraCats([...extraPresetCats(), name]);
        presetUi.filter = "cat:" + name;
        renderPresetPage();
        return;
      }
      const rename = e.target.closest("[data-cat-rename]");
      if (rename) { await renamePresetCategory(rename.dataset.catRename); return; }
      const dropCat = e.target.closest("[data-cat-del]");
      if (dropCat) { await deletePresetCategory(dropCat.dataset.catDel); return; }
      if (e.target.closest("#preset-new") || e.target.closest("[data-preset-new]")) { openPresetDrawer("prompt", ""); return; }
      if (e.target.closest("#pd-cancel")) { closePresetDrawer(); return; }
      if (e.target.closest("#pd-save")) { await savePresetDrawer(); return; }
      if (e.target.closest("#pd-recapture")) {
        const drawer = $("preset-drawer");
        const existing = findPreset("gen", drawer.dataset.id);
        if (!existing) return;
        Object.assign(existing, captureGenPreset(existing.name, U.presetCategory(existing), existing.favorite, existing));
        existing.thumb = latestGalleryThumb() || existing.thumb;
        await persistGenPreset(existing);
        openPresetDrawer("gen", existing.id);
        toast("Снимок настроек обновлён.");
        return;
      }
      const kindOf = (node) => (node && node.dataset.presetKind) === "gen" ? "gen" : "prompt";
      const apply = e.target.closest("[data-preset-apply]");
      const edit = e.target.closest("[data-preset-edit]");
      const dup = e.target.closest("[data-preset-dup]");
      const del = e.target.closest("[data-preset-del]");
      const fav = e.target.closest("[data-preset-fav]");
      if (apply) { await applyPresetCard(kindOf(apply), apply.dataset.presetApply); return; }
      if (edit) { openPresetDrawer(kindOf(edit), edit.dataset.presetEdit); return; }
      if (dup) { await duplicatePresetCard(kindOf(dup), dup.dataset.presetDup); return; }
      if (del) { await deletePresetCard(kindOf(del), del.dataset.presetDel); return; }
      if (fav) { await togglePresetFav(kindOf(fav), fav.dataset.presetFav); return; }
    });
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); }
      if (e.key === "Escape") {
        if (menuName) { closeMenus(); return; }
        if (!$("pp-pop").hidden) { closePromptPop(); return; }
        if (document.querySelector(".modal-back")) return;
        if (typingTarget(e.target)) return;
        collapseZeroImageStudio();
      }
    });
    document.addEventListener("visibilitychange", () => {
      if (editor) editor.space = false;
      syncStudioPause();
    });
    const more = $("gal-more");
    if (more) more.onclick = () => loadMoreGallery().catch((err) => toast(err.message || String(err)));
    window.addEventListener("message", async (ev) => {
      const msg = ev.data || {};
      if (msg.type !== "zeroimagestudio-open") return;
      if (!booted) { pendingGraphOpen = msg; return; }
      await applyGraphOpen(msg);
    });
  }

  async function applyGraphOpen(msg) {
    state.collapsed = false;
    syncStudioPause();
    if (msg.projectId && msg.projectId !== state.projectId) {
      try { await loadProject(msg.projectId); } catch (err) { toast(err.message); }
    }
    if (msg.imageUrl && msg.imageUrl !== state._graphImage) {
      state._graphImage = msg.imageUrl;
      try {
        const img = await loadImage(msg.imageUrl);
        await offerImportImage(img, "Вход IMAGE");
      } catch (err) { toast("Не удалось прочитать изображение со входа ноды."); }
    } else if (msg.imageLinked && !msg.imageUrl) {
      toast("Ко входу IMAGE подключён кадр, но файла ещё нет. Выберите файл в Load Image или выполните граф.");
    }
  }

  function onFileChange(e) {
    const t = e.target;
    const c = cfg();
    if (t.dataset.file) {
      const key = t.dataset.file;
      c[key] = key === "qwen_resolution" || key === "inpaint_grow" ? Number(t.value) : t.value;
      if (key === "loader" || key === "method" || key === "encoder") renderFiles();
      if (key === "method" && c.method === "krea2_edit" && !(c.krea && c.krea.task)) applyKreaTaskDefaults("general");
    }
    if (t.dataset.krea) c.krea[t.dataset.krea] = t.dataset.krea === "grounding_px" ? Number(t.value) : t.value;
    if (t.dataset.file === "method" || t.dataset.krea === "grounding_px") {
      syncKreaStack();
      renderKreaChrome();
      renderRefs();
      renderLoras();
    }
    renderPipe();
    renderModelSummary();
    renderModelWarn();
    updateGenerateButton();
  }

  async function onLoraClick(e) {
    const add = e.target.closest("#btn-lora-add");
    if (add) { openLoraPicker(); return; }
    const swap = e.target.closest("[data-lora-swap]");
    if (swap) { openLoraPicker({ swapTask: true }); return; }
    const rm = e.target.closest("[data-lora-remove]");
    if (rm) {
      const victim = activeLoras().find((l) => l.name === rm.dataset.loraRemove);
      if (victim && victim.role === "task") return;
      cfg().loras = activeLoras().filter((l) => l.name !== rm.dataset.loraRemove);
      if (state.loraSelected === rm.dataset.loraRemove) state.loraSelected = "";
      renderLoras(); renderPipe(); updateFinal();
      return;
    }
    const en = e.target.closest("[data-lora-enable]");
    if (en) {
      const l = activeLoras().find((x) => x.name === en.dataset.loraEnable);
      if (l) l.enabled = !l.enabled;
      if (l && l.role === "task") rememberTaskLora();
      renderLoras(); renderPipe(); updateFinal();
      updateGenerateButton();
      return;
    }
    const info = e.target.closest("[data-lora-info]");
    if (info) { state.loraSelected = state.loraSelected === info.dataset.loraInfo ? "" : info.dataset.loraInfo; renderLoras(); return; }
    const folder = e.target.closest("[data-folder]");
    if (folder) { state.loraFolder = folder.dataset.folder; renderLoras(); return; }
    const toggle = e.target.closest("[data-lora-toggle]");
    if (toggle) {
      const name = toggle.dataset.loraToggle;
      const l = activeLoras().find((x) => x.name === name);
      if (l && l.enabled) l.enabled = false;
      else ensureLora(name).enabled = true;
      const touched = activeLoras().find((x) => x.name === name);
      if (touched && touched.role === "task") rememberTaskLora();
      state.loraSelected = name;
      renderLoras(); renderPipe();
      return;
    }
    const row = e.target.closest("[data-lora]");
    if (row && !e.target.closest("[data-lora-toggle]")) { state.loraSelected = row.dataset.lora; renderLoras(); }
    const civ = e.target.closest("[data-civitai]");
    if (civ) {
      const name = civ.dataset.loraName || state.loraSelected;
      const l = activeLoras().find((x) => x.name === name);
      if (!l) return;
      state.loraSelected = l.name;
      try {
        const data = await api("/zeroimagestudio/loras/civitai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: l.name }) });
        l.sha256 = data.sha256;
        l.civitai = data.info;
        if (data.info && data.info.trained_words) {
          l.triggers = data.info.trained_words.map((text) => ({ text, enabled: true }));
        }
        renderLoras();
        renderChips();
      } catch (err) { toast(err.message); }
    }
    const trig = e.target.closest("[data-trig]");
    if (trig) {
      const name = trig.dataset.loraName || state.loraSelected;
      const l = activeLoras().find((x) => x.name === name);
      if (!l || !l.triggers[trig.dataset.trig]) return;
      const t = l.triggers[trig.dataset.trig];
      t.enabled = t.enabled === false;
      renderLoras(); updateFinal();
    }
  }

  function onLoraChange(e) {
    const name = e.target.dataset.loraName || state.loraSelected;
    const l = activeLoras().find((x) => x.name === name);
    if (!l) return;
    if (e.target.dataset.trigMode) { l.trigger_mode = e.target.value; updateFinal(); }
    if (l.role === "task") rememberTaskLora();
  }

  function onLoraInput(e) {
    const name = e.target.dataset.loraName || state.loraSelected;
    const l = activeLoras().find((x) => x.name === name);
    if (!l) return;
    if (e.target.dataset.str) {
      const v = parseFloat(e.target.value);
      if (e.target.dataset.str === "model") {
        l.strength_model = v;
        if (!e.target.closest("#lora-detail")) l.strength_clip = v;
      } else l.strength_clip = v;
      const num = e.target.parentElement.querySelector("[data-str-num]");
      if (num) num.value = v.toFixed(2);
    }
    if (e.target.dataset.strNum) {
      const v = parseFloat(e.target.value) || 0;
      if (e.target.dataset.strNum === "model") l.strength_model = v; else l.strength_clip = v;
    }
    if (l.role === "task") rememberTaskLora();
  }

  const LAYOUT_KEY = "zeroimagestudio.layout";
  const DEFAULT_LAYOUT = {
    left: ["model", "refs", "lora", "sampler"],
    center: ["canvas", "prompt"],
    right: ["inspector", "layers", "gallery"],
    collapsed: {},
  };

  function normalizeLayout(raw) {
    const def = DEFAULT_LAYOUT;
    const known = new Set([...def.left, ...def.center, ...def.right]);
    const used = new Set();
    const cols = { left: [], center: [], right: [] };
    const source = raw && typeof raw === "object" ? raw : {};
    for (const col of ["left", "center", "right"]) {
      for (const id of source[col] || []) {
        if (typeof id !== "string" || !known.has(id) || used.has(id)) continue;
        if (id === "canvas" && col !== "center") continue;
        used.add(id);
        cols[col].push(id);
      }
    }
    if (!used.has("canvas")) cols.center.unshift("canvas");
    used.add("canvas");
    for (const id of known) {
      if (used.has(id)) continue;
      const home = def.left.includes(id) ? "left" : def.right.includes(id) ? "right" : "center";
      cols[home].push(id);
    }
    const at = cols.center.indexOf("canvas");
    if (at > 0) {
      cols.center.splice(at, 1);
      cols.center.unshift("canvas");
    }
    const collapsed = {};
    for (const [id, on] of Object.entries(source.collapsed || {})) {
      if (known.has(id) && id !== "canvas" && on) collapsed[id] = true;
    }
    const hidden = {};
    for (const [id, on] of Object.entries(source.hidden || {})) {
      if (known.has(id) && id !== "canvas" && on) hidden[id] = true;
    }
    return { left: cols.left, center: cols.center, right: cols.right, collapsed, hidden };
  }

  function readLayout() {
    try { return normalizeLayout(JSON.parse(localStorage.getItem(LAYOUT_KEY) || "null")); }
    catch { return normalizeLayout(null); }
  }

  function applyLayout(layout) {
    state.layout = layout;
    for (const col of ["left", "center", "right"]) {
      const host = document.querySelector(".cols > ." + col);
      if (!host) continue;
      for (const id of layout[col]) {
        const node = document.querySelector(`.node[data-panel="${id}"]`);
        if (node) host.appendChild(node);
      }
    }
    document.querySelectorAll(".node[data-panel]").forEach((node) => {
      const id = node.dataset.panel;
      const on = id !== "canvas" && !!layout.collapsed[id];
      const gone = id !== "canvas" && !!(layout.hidden && layout.hidden[id]);
      node.classList.toggle("collapsed", on);
      node.classList.toggle("panel-hidden", gone);
      sealCollapsed(node);
      const dot = node.querySelector(":scope > .nh .d");
      if (dot && id !== "canvas") dot.title = on ? "Развернуть" : "Свернуть";
    });
  }

  function sealCollapsed(node) {
    if (!node || !node.classList) return;
    const collapsed = node.classList.contains("collapsed") && node.dataset.panel !== "canvas";
    for (const child of node.children) {
      if (child.classList.contains("nh") || child.classList.contains("sock")) continue;
      if (collapsed) {
        if (!child.hasAttribute("hidden")) child.setAttribute("hidden", "");
      } else if (child.hasAttribute("hidden")) {
        child.removeAttribute("hidden");
      }
    }
  }

  function layoutFromDom() {
    const read = (sel) => [...document.querySelector(sel).children].filter((n) => n.classList && n.classList.contains("node") && n.dataset && n.dataset.panel).map((n) => n.dataset.panel);
    return normalizeLayout({
      left: read(".cols > .left"),
      center: read(".cols > .center"),
      right: read(".cols > .right"),
      collapsed: (state.layout && state.layout.collapsed) || {},
      hidden: (state.layout && state.layout.hidden) || {},
    });
  }

  function saveLayout() {
    const layout = state.layout || normalizeLayout(null);
    state.layout = layout;
    try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch (err) { /* private mode */ }
    clearTimeout(saveLayout._t);
    saveLayout._t = setTimeout(() => {
      api("/zeroimagestudio/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ layout }),
      }).then((saved) => { if (saved) state.settings = saved; }).catch(() => {});
    }, 250);
  }

  function resetLayout() {
    try { localStorage.removeItem(LAYOUT_KEY); } catch (err) { /* private mode */ }
    applyLayout(normalizeLayout(null));
    saveLayout();
    toast("Раскладка сброшена.");
  }

  function togglePanel(id) {
    if (!state.layout || id === "canvas") return;
    if (state.layout.collapsed[id]) delete state.layout.collapsed[id];
    else state.layout.collapsed[id] = true;
    applyLayout(state.layout);
    saveLayout();
  }

  function placeDropLine(x, y, node) {
    const hit = document.elementFromPoint(x, y);
    const col = hit && hit.closest && hit.closest(".cols > .left, .cols > .center, .cols > .right");
    if (!col) return;
    let line = $("drop-line");
    if (!line) {
      line = document.createElement("div");
      line.id = "drop-line";
      line.className = "drop-line";
    }
    const panels = [...col.querySelectorAll(":scope > [data-panel]")].filter((p) => p !== node && p !== line);
    let before = null;
    for (const panel of panels) {
      const rect = panel.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) { before = panel; break; }
    }
    if (before) col.insertBefore(line, before);
    else col.appendChild(line);
  }

  function commitDrop(node) {
    const line = $("drop-line");
    if (!line || !line.parentElement) return;
    line.parentElement.insertBefore(node, line);
    line.remove();
    applyLayout(layoutFromDom());
    saveLayout();
  }

  function bindPanelChrome() {
    const cols = document.querySelector(".cols");
    if (!cols || cols.dataset.panels) return;
    cols.dataset.panels = "1";
    let drag = null;
    cols.addEventListener("pointerdown", (e) => {
      const header = e.target.closest(".nh");
      if (!header || !cols.contains(header)) return;
      const node = header.closest("[data-panel]");
      if (!node || node.dataset.panel === "canvas") return;
      if (e.target.closest("button, input, select, textarea, a, .d")) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const move = (ev) => {
        if (!drag && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 4) return;
        if (!drag) {
          drag = node;
          node.classList.add("dragging");
        }
        placeDropLine(ev.clientX, ev.clientY, node);
      };
      const up = () => {
        header.removeEventListener("pointermove", move);
        header.removeEventListener("pointerup", up);
        header.removeEventListener("pointercancel", up);
        node.classList.remove("dragging");
        if (drag) commitDrop(node);
        const line = $("drop-line");
        if (line) line.remove();
        drag = null;
      };
      header.addEventListener("pointermove", move);
      header.addEventListener("pointerup", up);
      header.addEventListener("pointercancel", up);
      try { header.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    });
    cols.addEventListener("click", (e) => {
      const dot = e.target.closest(".nh .d");
      if (!dot || !cols.contains(dot)) return;
      const node = dot.closest("[data-panel]");
      if (!node || node.dataset.panel === "canvas") return;
      e.preventDefault();
      e.stopPropagation();
      togglePanel(node.dataset.panel);
    });
    cols.addEventListener("dblclick", (e) => {
      const header = e.target.closest(".nh");
      if (!header || !cols.contains(header)) return;
      if (e.target.closest("button, input, select, textarea, a, .d")) return;
      const node = header.closest("[data-panel]");
      if (!node || node.dataset.panel === "canvas") return;
      togglePanel(node.dataset.panel);
    });
    const sealObs = new MutationObserver((records) => {
      for (const rec of records) {
        const node = rec.target.closest && rec.target.closest(".node.collapsed");
        if (node) sealCollapsed(node);
      }
    });
    sealObs.observe(cols, { subtree: true, childList: true, attributes: true, attributeFilter: ["hidden", "class"] });
  }

  function focusGraph() {
    if (window.parent !== window) window.parent.postMessage({ type: "zeroimagestudio-focus" }, "*");
    else toast("Команда возвращает к ноде, когда ZeroImageStudio открыт из графа.");
  }

  let booted = false;
  let pendingGraphOpen = null;

  async function boot() {
    applyLayout(readLayout());
    bindPanelChrome();
    editor = new Editor($("stage"));
    editor.onChange = () => {
      state.dirty = true;
      const sub = $("project-sub");
      if (sub) sub.textContent = "есть несохранённые правки";
    };
    bindStatic();
    connectWs();
    try {
      const [hints, models, loras, presets, gallery, settings, promptPresets] = await Promise.all([
        api("/zeroimagestudio/hints"), api("/zeroimagestudio/models"), api("/zeroimagestudio/loras"),
        api("/zeroimagestudio/collection/presets"), api("/zeroimagestudio/gallery?offset=0&limit=48"), api("/zeroimagestudio/settings"),
        api("/zeroimagestudio/collection/prompt_presets"),
      ]);
      state.hints = hints.hints || [];
      state.catalog = models;
      state.loras = loras.files || [];
      state.presets = presets.items || [];
      state.gallery = gallery.items || [];
      state.galleryTotal = Number(gallery && gallery.total != null ? gallery.total : state.gallery.length) || 0;
      state.settings = settings;
      const storedPresets = (promptPresets && promptPresets.items) || [];
      if (storedPresets.length) state.promptPresets = storedPresets.map((p, i) => normalizePreset(p, i));
      else {
        state.promptPresets = state.promptPresets.map((p, i) => normalizePreset(p, i));
        for (const preset of state.promptPresets) await persistPreset(preset);
      }
      if (settings && settings.layout) applyLayout(normalizeLayout(settings.layout));
      if (models.krea_import_error) toast("Встроенные ноды Krea 2 Edit не загрузились: " + models.krea_import_error);
      fillLlmPresets();
      try {
        const assets = await api("/zeroimagestudio/assets");
        state.assets = assets.items || [];
      } catch (err) { state.assets = []; }
    } catch (err) {
      toast("ComfyUI API недоступен: " + err.message);
    }
    const params = new URLSearchParams(location.search);
    if (params.get("project")) {
      try { await loadProject(params.get("project")); } catch (err) { toast(err.message); renderAll(); }
    } else {
      const hint = state.hints.find((h) => h.id === state.hintId);
      if (hint) applyHint(hint);
      if (params.get("demo") === "1") await loadExample();
      else {
        syncDefaultArea();
        editor.fit();
        renderAll();
      }
    }
    state.dirty = false;
    renderGallery();
    pollStats();
    booted = true;
    if (pendingGraphOpen) {
      const queued = pendingGraphOpen;
      pendingGraphOpen = null;
      await applyGraphOpen(queued);
    }
    window.parent.postMessage({ type: "zeroimagestudio-ready" }, "*");
  }

  function syncStudioPause() {
    state.studioPaused = !!(state.collapsed || document.hidden);
    if (state.studioPaused && editor) editor.space = false;
  }

  let galleryLoading = false;
  async function loadMoreGallery() {
    if (galleryLoading) return;
    galleryLoading = true;
    try {
      const offset = (state.gallery || []).filter((it) => !it.example).length;
      const page = await api("/zeroimagestudio/gallery?offset=" + offset + "&limit=" + (state.galleryLimit || 48));
      const seen = new Set((state.gallery || []).map((it) => it.id));
      for (const it of page.items || []) if (it && !seen.has(it.id)) state.gallery.push(it);
      if (page && page.total != null) state.galleryTotal = Number(page.total) || 0;
      renderGallery();
    } finally {
      galleryLoading = false;
    }
  }

  async function pollStats() {
    if (state.studioPaused && !state.running) {
      setTimeout(pollStats, 4000);
      return;
    }
    try {
      const [sys, queue] = await Promise.all([api("/system_stats"), api("/queue")]);
      const dev = (sys.devices && sys.devices[0]) || {};
      const total = dev.vram_total ? (dev.vram_total / 1024 / 1024 / 1024) : 0;
      const free = dev.vram_free ? (dev.vram_free / 1024 / 1024 / 1024) : 0;
      const used = total ? (total - free) : 0;
      const name = (dev.name || "CPU").replace("cuda:0 ", "");
      const pending = ((queue.queue_running || []).length + (queue.queue_pending || []).length);
      const detail = total
        ? `${name} · VRAM ${used.toFixed(1)}/${total.toFixed(0)} ГБ · очередь ${pending}`
        : `${name} · очередь ${pending}`;
      const shortName = total ? `${used.toFixed(1)}/${Math.round(total)} ГБ` : (name || "CPU").slice(0, 12);
      $("sys-stats").textContent = pending ? `${shortName} · ${pending}` : shortName;
      $("sys-stats").title = detail;
    } catch { /* studio opened outside ComfyUI */ }
    setTimeout(pollStats, 4000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
