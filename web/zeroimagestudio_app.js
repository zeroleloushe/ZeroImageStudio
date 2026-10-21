/* ZeroImageStudio — холст, слои, два пайплайна. Runs inside zeroimagestudio.html.
   If ComfyUI imports this file as an extension, the guard below makes it a no-op. */
(function () {
  if (!window.__ZEROIMAGESTUDIO_PAGE) return;

  const $ = (id) => document.getElementById(id);
  const BLENDS = [
    ["normal", "Нормальный"], ["multiply", "Умножение"], ["screen", "Экран"],
    ["overlay", "Перекрытие"], ["soft-light", "Мягкий свет"], ["hard-light", "Жёсткий свет"],
    ["darken", "Затемнение"], ["lighten", "Осветление"], ["color-dodge", "Осветление основы"],
    ["color-burn", "Затемнение основы"], ["difference", "Разница"], ["exclusion", "Исключение"],
  ];
  const state = {
    projectId: null,
    projectName: "Портрет_волосы",
    pipeline: "edit",
    hintId: "krea2_identity_edit",
    hintByMode: { create: "krea2", edit: "krea2_identity_edit" },
    prompt: "медно-рыжие волосы, мягкие естественные пряди, сохранить текстуру и объём, тёплый контровой свет",
    negative: "",
    promptPresets: [
      { id: "p1", name: "Портрет-студия", category: "Портрет", text: "студийный портрет, мягкий свет, резкий фокус", position: "before", enabled: true, order: 0 },
      { id: "p2", name: "Детализация кожи 8k", category: "Детализация", text: "детальная кожа, естественные поры", position: "after", enabled: true, order: 1 },
      { id: "p3", name: "Плёнка Kodak", category: "Плёнка", text: "плёночное зерно, kodak portra", position: "after", enabled: false, order: 2 },
    ],
    sampler: { seed: 48211937, seedMode: "fixed", steps: 28, cfg: 3.5, denoise: 0.72, sampler: "euler", scheduler: "simple", batch: 1 },
    create: blankPipe("create"),
    edit: blankPipe("edit"),
    references: [],
    area: { outW: 1024, outH: 1024, aspect: "1:1", context: 0.15, feather: 48, paste: "poisson", colorMatch: true },
    tool: "genarea",
    color: "#e7c27a",
    brush: { size: 64, hardness: 0.3, opacity: 1 },
    hints: [],
    catalog: null,
    loras: [],
    loraFolder: "",
    loraQuery: "",
    loraSelected: "",
    presets: [],
    gallery: [],
    settings: null,
    running: false,
    promptId: null,
  };
  state.edit.method = "krea2_edit";
  state.edit.clip_type = "krea2";
  state.edit.krea.grounding_px = 1024;

  function blankPipe(kind) {
    return {
      loader: "diffusion", checkpoint: "", unet: "", clip: "", vae: "",
      clip_type: kind === "edit" ? "krea2" : "stable_diffusion",
      weight_dtype: "default", latent_mode: "sd3", encoder: "clip",
      method: "inpaint", inpaint_mode: "vae_encode", inpaint_grow: 6,
      qwen_resolution: 1024,
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

  function toast(text) {
    const el = $("toast");
    el.hidden = false;
    el.textContent = text;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 5200);
  }

  async function api(path, opts) {
    const res = await fetch(path, opts);
    const type = res.headers.get("content-type") || "";
    const body = type.includes("json") ? await res.json() : await res.text();
    if (!res.ok) {
      let msg = res.statusText;
      if (body && body.error) msg = typeof body.error === "string" ? body.error : JSON.stringify(body.error);
      else if (typeof body === "string") msg = body.slice(0, 500);
      throw new Error(msg || ("HTTP " + res.status));
    }
    return body;
  }

  function canvasBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Не удалось открыть изображение"));
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
        '<div class="ga" id="ga"><div class="lab"></div>' +
        '<div class="hd" data-h="nw"></div><div class="hd" data-h="ne"></div>' +
        '<div class="hd" data-h="sw"></div><div class="hd" data-h="se"></div></div>';
      this.stage.appendChild(this.overlay);
      this.ga = this.overlay.querySelector(".ga");
      this.doc = { w: 800, h: 1000 };
      this.layers = [];
      this.active = 0;
      this.zoom = 0.5;
      this.panX = 40;
      this.panY = 30;
      this.gen = { x: 144, y: 70, w: 512, h: 512 };
      this.maskCanvas = document.createElement("canvas");
      this.maskCtx = null;
      this.selection = null;
      this.undo = [];
      this.redo = [];
      this.space = false;
      this.drag = null;
      this._raf = 0;
      this.resizeMask();
      this.bind();
      this.resizeView();
      new ResizeObserver(() => this.resizeView()).observe(stage);
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
      const pad = 64;
      this.zoom = Math.max(0.05, Math.min((r.width - pad) / this.doc.w, (r.height - pad) / this.doc.h));
      this.panX = (r.width - this.doc.w * this.zoom) / 2;
      this.panY = (r.height - this.doc.h * this.zoom) / 2;
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
      ctx.fillStyle = "rgba(0,0,0,.45)";
      ctx.fillRect(10, 14, this.doc.w, this.doc.h);
      ctx.strokeStyle = "#000";
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
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      }
      if (this.maskArea() > 0) {
        ctx.save();
        ctx.globalAlpha = 0.42;
        ctx.drawImage(this.maskTint(), 0, 0);
        ctx.restore();
      }
      if (this.selection) this.strokeSelection(ctx);
      ctx.restore();
      this.placeGen();
      const info = $("canvas-info");
      if (info) info.textContent = `${this.doc.w} × ${this.doc.h} · ${Math.round(this.zoom * 100)}% · RGB 8 бит`;
    }

    maskTint() {
      const c = this._tint || (this._tint = document.createElement("canvas"));
      if (c.width !== this.maskCanvas.width || c.height !== this.maskCanvas.height) {
        c.width = this.maskCanvas.width;
        c.height = this.maskCanvas.height;
      }
      const g = c.getContext("2d");
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
      this.ga.style.pointerEvents = state.tool === "genarea" ? "auto" : "none";
      const lab = this.ga.querySelector(".lab");
      lab.textContent = `Область генерации ${Math.round(g.w)}×${Math.round(g.h)} → ${state.area.outW}×${state.area.outH}`;
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
        ctx.drawImage(layer.canvas, 0, 0);
        ctx.restore();
      }
      return c;
    }

    maskArea() {
      const data = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height).data;
      let n = 0;
      for (let i = 0; i < data.length; i += 16) if (data[i] > 16) n++;
      return n * 4;
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
        layers: this.layers.map((l) => ({
          id: l.id, name: l.name, x: l.x, y: l.y, visible: l.visible, opacity: l.opacity,
          blend: l.blend, locked: l.locked, meta: l.meta,
          w: l.canvas.width, h: l.canvas.height,
          data: l.ctx.getImageData(0, 0, l.canvas.width, l.canvas.height),
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
          this.thumb(layer);
          return layer;
        });
        this.active = Math.min(rec.active, this.layers.length - 1);
      } else if (rec.type === "pixels") {
        const layer = this.layers.find((l) => l.id === rec.id);
        if (layer && rec.data) layer.ctx.putImageData(rec.data, 0, 0);
        if (rec.mask) this.maskCtx.putImageData(rec.mask, 0, 0);
        this.thumb(layer);
      } else if (rec.type === "move") {
        const layer = this.layers.find((l) => l.id === rec.id);
        if (layer) { layer.x = rec.x; layer.y = rec.y; }
      }
      this.requestDraw();
      renderLayers();
      renderInspector();
    }

    pushUndo(rec) {
      this.undo.push(rec);
      if (this.undo.length > 20) this.undo.shift();
      this.redo = [];
    }

    undo() {
      const rec = this.undo.pop();
      if (!rec) return;
      if (rec.type === "full") this.redo.push(this.fullSnapshot());
      else if (rec.type === "pixels") {
        const layer = this.layers.find((l) => l.id === rec.id);
        this.redo.push({ type: "pixels", id: rec.id, data: layer ? layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height) : rec.data, mask: this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height) });
      } else if (rec.type === "move") {
        const layer = this.layers.find((l) => l.id === rec.id);
        this.redo.push({ type: "move", id: rec.id, x: layer ? layer.x : rec.x, y: layer ? layer.y : rec.y });
      }
      this.restore(rec);
    }

    redo() {
      const rec = this.redo.pop();
      if (!rec) return;
      if (rec.type === "full") this.undo.push(this.fullSnapshot());
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

    bind() {
      const down = (e) => this.pointerDown(e);
      this.canvas.addEventListener("pointerdown", down);
      this.ga.addEventListener("pointerdown", (e) => {
        if (state.tool !== "genarea") return;
        e.preventDefault();
        e.stopPropagation();
        const p = this.screenToDoc(e.clientX, e.clientY);
        const handle = e.target.dataset ? e.target.dataset.h : null;
        this.drag = { kind: handle ? "resize" : "move-ga", handle, x: p.x, y: p.y, gen: { ...this.gen }, pid: e.pointerId };
        this.ga.setPointerCapture(e.pointerId);
      });
      window.addEventListener("pointermove", (e) => this.pointerMove(e));
      window.addEventListener("pointerup", (e) => this.pointerUp(e));
      this.stage.addEventListener("wheel", (e) => {
        e.preventDefault();
        const before = this.screenToDoc(e.clientX, e.clientY);
        const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
        this.zoom = Math.min(8, Math.max(0.05, this.zoom * factor));
        const r = this.canvas.getBoundingClientRect();
        this.panX = e.clientX - r.left - before.x * this.zoom;
        this.panY = e.clientY - r.top - before.y * this.zoom;
        this.requestDraw();
      }, { passive: false });
      window.addEventListener("keydown", (e) => {
        if (e.code === "Space") this.space = true;
        const tag = (e.target.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select") return;
        const map = { KeyV: "move", KeyM: "select", KeyL: "lasso", KeyT: "transform", KeyC: "crop", KeyB: "brush", KeyE: "eraser", KeyI: "eyedrop", KeyQ: "mask", KeyG: "genarea" };
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.shiftKey ? this.redo() : this.undo(); return; }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); this.redo(); return; }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === "Delete" || e.key === "Backspace") { this.deleteActive(); return; }
        if (e.key === "[") { state.brush.size = Math.max(1, state.brush.size - 4); const b = $("brush-size"); if (b) b.value = state.brush.size; renderTags(); }
        if (e.key === "]") { state.brush.size = Math.min(300, state.brush.size + 4); const b = $("brush-size"); if (b) b.value = state.brush.size; renderTags(); }
        if (map[e.code]) { setTool(map[e.code]); }
      });
      window.addEventListener("keyup", (e) => { if (e.code === "Space") this.space = false; });
    }

    pointerDown(e) {
      if (e.button === 1 || this.space || state.tool === "hand") {
        this.drag = { kind: "pan", x: e.clientX, y: e.clientY, panX: this.panX, panY: this.panY };
        return;
      }
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
        this.drag = { kind: "new-ga", x: p.x, y: p.y, gen: { ...this.gen } };
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
        this.undo.pop(); // push happens on up; store start
        this.drag = { kind: "move", id: layer.id, x: p.x, y: p.y, lx: layer.x, ly: layer.y };
        return;
      }
      if (tool === "transform") {
        this.drag = { kind: "transform", id: this.activeLayer() && this.activeLayer().id, x: p.x, y: p.y, snapshot: this.fullSnapshot() };
        return;
      }
      if (tool === "brush" || tool === "eraser" || tool === "mask") {
        const layer = this.activeLayer();
        if (tool !== "mask" && (!layer || layer.locked)) { toast(layer && layer.locked ? "Слой заблокирован." : "Нет слоя."); return; }
        const rec = { type: "pixels", id: layer && layer.id };
        if (tool === "mask") rec.mask = this.maskCtx.getImageData(0, 0, this.maskCanvas.width, this.maskCanvas.height);
        else rec.data = layer.ctx.getImageData(0, 0, layer.canvas.width, layer.canvas.height);
        this.drag = { kind: "paint", x: p.x, y: p.y, rec };
        this.stamp(p.x, p.y);
      }
    }

    pointerMove(e) {
      if (!this.drag) return;
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
      if (d.kind === "paint" && d.rec) { this.pushUndo(d.rec); this.thumb(this.activeLayer()); renderLayers(); renderTags(); }
      if (d.kind === "move") this.pushUndo({ type: "move", id: d.id, x: d.lx, y: d.ly });
      if (d.kind === "crop" && this.selection && this.selection.w > 4 && this.selection.h > 4) this.applyCrop(this.selection);
      if (d.kind === "transform" && d.snapshot) { this.bakeActive(); this.pushUndo(d.snapshot); }
      renderInspector();
    }

    dragGen(d, p) {
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
      renderInspector();
    }

    strokeLine(x0, y0, x1, y1) {
      const dist = Math.hypot(x1 - x0, y1 - y0);
      const step = Math.max(1, state.brush.size * 0.25);
      const n = Math.max(1, Math.ceil(dist / step));
      for (let i = 0; i <= n; i++) this.stamp(x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n);
    }

    stamp(x, y) {
      const size = state.brush.size;
      const hard = state.brush.hardness;
      if (state.tool === "mask") {
        const ctx = this.maskCtx;
        ctx.save();
        const grd = ctx.createRadialGradient(x, y, size * hard * 0.5, x, y, size / 2);
        grd.addColorStop(0, `rgba(255,255,255,${state.brush.opacity})`);
        grd.addColorStop(1, "rgba(255,255,255,0)");
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(x, y, size / 2, 0, Math.PI * 2);
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
    const cursors = { brush: "crosshair", eraser: "crosshair", mask: "crosshair", hand: "grab", zoom: "zoom-in", move: "move", genarea: "crosshair", crop: "crosshair", select: "crosshair", lasso: "crosshair", eyedrop: "crosshair", transform: "move" };
    editor.canvas.style.cursor = cursors[name] || "default";
    editor.requestDraw();
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
    renderModelSummary();
    $("prompt").value = state.prompt;
    $("negative").value = state.negative;
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
      return `<button type="button" class="mrow ${on ? "on" : ""}" data-hint="${h.id}"><span class="rd"></span><b>${escapeHtml(h.name)}</b><span class="tg">${tags}</span></button>`;
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
      ${sug.unet ? `<div class="mu">Подсказка: ${escapeHtml(sug.unet)} · ${escapeHtml(sug.clip || "")} · ${escapeHtml(sug.vae || "")}</div>` : ""}
    `;
    const methodRow = state.pipeline === "edit"
      ? `<label>Способ <select class="dd" data-file="method" style="width:100%">${["inpaint", "krea2_edit", "qwen_image_21", "qwen_image"].map((m) => `<option ${c.method === m ? "selected" : ""} value="${m}">${methodLabel(m)}</option>`).join("")}</select></label>`
      : `<label>Энкодер <select class="dd" data-file="encoder" style="width:100%">${[["clip", "CLIPTextEncode"], ["qwen_image_21", "TextEncodeQwenImage21"]].map(([v, n]) => `<option ${c.encoder === v ? "selected" : ""} value="${v}">${n}</option>`).join("")}</select></label>`;
    const krea = c.krea || {};
    const kreaRow = state.pipeline === "edit" && c.method === "krea2_edit" ? `
      <label>Fit <select class="dd" data-krea="fit_mode" style="width:100%"><option ${krea.fit_mode === "fit" ? "selected" : ""}>fit</option><option ${krea.fit_mode === "crop (legacy)" ? "selected" : ""}>crop (legacy)</option></select></label>
      <label>Позиция референса <select class="dd" data-krea="ref_position" style="width:100%">${["aligned (trained)", "beside (right of target)", "bag of features"].map((v) => `<option ${krea.ref_position === v ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Grounding, px <input class="f" data-krea="grounding_px" value="${krea.grounding_px}"></label>
      <label>Ноды <select class="dd" data-krea="impl" style="width:100%"><option value="internal" ${krea.impl !== "external" ? "selected" : ""}>встроенные</option><option value="external" ${krea.impl === "external" ? "selected" : ""}>пакет comfyui-krea2edit</option></select></label>` : "";
    const qwenRow = (state.pipeline === "edit" && (c.method === "qwen_image_21" || c.method === "qwen")) || c.encoder === "qwen_image_21"
      ? `<label>Qwen resolution <input class="f" data-file="qwen_resolution" value="${c.qwen_resolution || state.area.outW}"></label>` : "";
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
      `<div class="ref ${r.selected ? "on" : ""}" data-ref="${r.id}" title="Клик — выбрать для LLM"><img src="${r.url}"><s>${escapeHtml(r.name)}</s><button class="x" data-ref-del="${r.id}">×</button></div>`
    ).join("");
    host.innerHTML = cards +
      `<button class="ref add" id="ref-upload" type="button"><div><span data-i="upload" data-s="15"></span><br>Загрузить</div></button>` +
      `<button class="ref add" id="ref-from-layer" type="button"><div><span data-i="layers" data-s="15"></span><br>Из слоя</div></button>`;
    const n = state.references.length;
    if (state.pipeline === "edit") {
      const method = cfg().method;
      $("ref-cap").textContent = `для модели · ${n}`;
      $("ref-hint").textContent = method === "krea2_edit"
        ? "Для модели: исходный кроп и один дополнительный референс. Те же кадры может взять LLM. Клик по карточке выбирает кадр для LLM."
        : (method === "qwen_image_21" || method === "qwen")
          ? "Для модели: до 16 референсов, в промте <image1>…. Те же кадры может взять LLM. Клик по карточке выбирает кадр для LLM."
          : "Кроп холста идёт в модель как область правки. Референсы здесь — для LLM. Клик по карточке выбирает кадр.";
    } else {
      $("ref-cap").textContent = `для LLM-промта · ${n}`;
      $("ref-hint").textContent = "В режиме Создание референсы не идут в модель. «Описать изображение» и «Улучшить» берут выбранные кадры (если ничего не выбрано — все).";
    }
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
  }

  function activeLoras() { return cfg().loras; }

  function renderLoras() {
    const searchEl = document.activeElement && document.activeElement.id === "lora-search" ? document.activeElement : null;
    const caret = searchEl ? searchEl.selectionStart : null;
    const files = state.loras || [];
    $("lora-count").textContent = String(files.length);
    const enabled = activeLoras().filter((l) => l.enabled);
    const sum = enabled.reduce((s, l) => s + Number(l.strength_model || 0), 0);
    $("lora-sum").textContent = `${enabled.length} активны · Σ ${sum.toFixed(2)}`;
    const q = state.loraQuery.toLowerCase();
    const folder = state.loraFolder;
    const shown = files.filter((name) => {
      if (folder && !name.startsWith(folder + "/") && name !== folder) {
        if (!(folder && name.startsWith(folder))) return false;
      }
      if (folder && !name.startsWith(folder)) return false;
      if (q && !name.toLowerCase().includes(q)) return false;
      return true;
    }).slice(0, 80);
    const folders = {};
    files.forEach((name) => {
      const top = name.includes("/") ? name.split("/")[0] : "";
      folders[top] = (folders[top] || 0) + 1;
    });
    const tree = [`<button type="button" class="fld ${folder === "" ? "on" : ""}" data-folder="">Все<span class="c">${files.length}</span></button>`]
      .concat(Object.keys(folders).filter(Boolean).sort().map((f) =>
        `<button type="button" class="fld ${folder === f ? "on" : ""}" data-folder="${escapeHtml(f)}">${escapeHtml(f)}<span class="c">${folders[f]}</span></button>`
      )).join("");
    const rows = shown.map((name) => {
      const base = name.split("/").pop();
      const hit = activeLoras().find((l) => l.name === name);
      const on = hit && hit.enabled;
      return `<tr data-lora="${escapeHtml(name)}" class="${state.loraSelected === name ? "on" : ""}"><td><span class="cb ${on ? "on" : ""}" data-lora-toggle="${escapeHtml(name)}"></span></td><td>${escapeHtml(base)}</td><td class="mono">${on ? Number(hit.strength_model).toFixed(2) : "—"}</td><td class="mono">${on && hit.triggers ? hit.triggers.filter((t) => t.enabled !== false).length : ""}</td></tr>`;
    }).join("");
    const sel = activeLoras().find((l) => l.name === state.loraSelected) || null;
    const detail = sel ? loraDetail(sel) : `<div class="empty">Выберите LoRA в списке. Список читается из папки loras ComfyUI.</div>`;
    $("lora-panel").innerHTML = `
      <div class="row"><input id="lora-search" class="f" style="flex:1;font-family:inherit" placeholder="Поиск: имя, тег, триггер…" value="${escapeHtml(state.loraQuery)}"></div>
      <div class="row" style="align-items:flex-start;gap:8px;min-height:0">
        <div class="tree" style="width:128px;border-right:1px solid var(--ln);padding-right:6px;max-height:180px;overflow:auto">${tree}</div>
        <div style="flex:1;min-width:0;max-height:180px;overflow:auto">
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
      <div class="row"><b style="font-size:12.5px">${escapeHtml(l.name.split("/").pop())}</b><span class="tag tvi">${escapeHtml((info && info.base_model) || "LoRA")}</span>
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
      <span>Seed</span><div class="row"><input id="seed" class="f" style="flex:1" value="${s.seed}"><button class="b s" id="btn-seed" data-i="dice" data-s="12" type="button"></button>
        <select id="seed-mode" class="dd" style="width:78px"><option ${s.seedMode === "fixed" ? "selected" : ""}>fixed</option><option ${s.seedMode === "random" ? "selected" : ""}>random</option><option ${s.seedMode === "increment" ? "selected" : ""}>increment</option></select></div>
      <span>Шаги</span><div class="row"><input id="steps-range" class="range" type="range" min="1" max="80" value="${s.steps}"><input id="steps" class="f" style="width:48px" value="${s.steps}"></div>
      <span>CFG</span><div class="row"><input id="cfg-range" class="range" type="range" min="0" max="12" step="0.1" value="${s.cfg}"><input id="cfg" class="f" style="width:48px" value="${s.cfg}"></div>
      <span>Denoise</span><div class="row"><input id="denoise-range" class="range" type="range" min="0" max="1" step="0.01" value="${s.denoise}"><input id="denoise" class="f" style="width:48px" value="${s.denoise}"></div>
      <span>Сэмплер</span><select id="sampler" class="dd">${opt(cat.samplers, s.sampler)}</select>
      <span>Планировщик</span><select id="scheduler" class="dd">${opt(cat.schedulers, s.scheduler)}</select>
      <span>Батч</span><input id="batch" class="f" value="${s.batch}">
    `;
    $("gen-batch").textContent = `×${s.batch} · Ctrl+↵`;
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
    $("seed").onchange = () => { state.sampler.seed = Math.max(0, parseInt($("seed").value, 10) || 0); };
    $("seed-mode").onchange = () => { state.sampler.seedMode = $("seed-mode").value; };
    $("sampler").onchange = () => { state.sampler.sampler = $("sampler").value; renderPipe(); };
    $("scheduler").onchange = () => { state.sampler.scheduler = $("scheduler").value; };
    $("batch").onchange = () => { state.sampler.batch = Math.max(1, Math.min(8, parseInt($("batch").value, 10) || 1)); $("gen-batch").textContent = `×${state.sampler.batch} · Ctrl+↵`; };
    $("btn-seed").onclick = () => { state.sampler.seed = Math.floor(Math.random() * 1e9); $("seed").value = state.sampler.seed; };
  }

  function renderInspector() {
    const g = editor.gen;
    const a = state.area;
    const scale = (g.w > 0) ? (a.outW / g.w) : 1;
    $("inspector").innerHTML = `
      <div class="kv" style="grid-template-columns:auto 1fr auto 1fr">
        <span>X</span><input id="gx" class="f" value="${g.x}"><span>Y</span><input id="gy" class="f" value="${g.y}">
        <span>W</span><input id="gw" class="f" value="${g.w}"><span>H</span><input id="gh" class="f" value="${g.h}">
        <span>Выход</span><select id="gout" class="dd">${[[1024,1024],[768,768],[512,512],[1056,1056],[1280,720],[832,1216],[1536,1024]].map(([w,h]) => `<option ${a.outW===w&&a.outH===h?"selected":""} value="${w}x${h}">${w} × ${h}</option>`).join("")}<option value="custom" ${[[1024,1024],[768,768],[512,512],[1056,1056],[1280,720],[832,1216],[1536,1024]].some(([w,h])=>w===a.outW&&h===a.outH)?"":"selected"}>свои</option></select>
        <span>Аспект</span><select id="gaspect" class="dd">${[["free","свободно"],["1:1","1:1"],["3:4","3:4"],["4:3","4:3"],["16:9","16:9"],["9:16","9:16"]].map(([v,n]) => `<option value="${v}" ${a.aspect===v?"selected":""}>${n}</option>`).join("")}</select>
        <span>Вклейка</span><select id="gpaste" class="dd"><option value="poisson" ${a.paste==="poisson"?"selected":""}>Poisson</option><option value="feather" ${a.paste==="feather"?"selected":""}>Растушёвка</option><option value="hard" ${a.paste==="hard"?"selected":""}>Жёстко</option></select>
        <span>Шов</span><input id="gfeather" class="f" value="${a.feather}">
      </div>
      <div class="row" style="gap:6px"><span class="mu">Контекст</span><input id="gcontext" class="f" style="width:64px" value="${Math.round(a.context*100)}"><span class="mu">%</span>
        <label class="row" style="gap:4px"><input id="gcolor" type="checkbox" ${a.colorMatch?"checked":""}> цвет. подгон</label></div>
      <div class="row" style="gap:5px;flex-wrap:wrap">
        <span class="tag ${editor.maskArea()>8?"tgr":""}">маска ${editor.maskArea()>8?"✓":"—"}</span>
        <span class="tag ${a.colorMatch?"tbl":""}">цвет. подгон ${a.colorMatch?"✓":"—"}</span>
        <span class="tag">масштаб ×${scale.toFixed(2)}</span>
        <span class="tag to">→ новый слой</span>
        <button type="button" class="b s" id="btn-gen-full">Весь холст</button>
      </div>`;
    const num = (id, fn) => $(id).onchange = () => { fn(parseFloat($(id).value)); editor.requestDraw(); renderTags(); };
    num("gx", (v) => { editor.gen.x = clamp(v || 0, 0, editor.doc.w - 8); });
    num("gy", (v) => { editor.gen.y = clamp(v || 0, 0, editor.doc.h - 8); });
    num("gw", (v) => { editor.gen.w = Math.max(16, v || 16); });
    num("gh", (v) => { editor.gen.h = Math.max(16, v || 16); });
    $("gout").onchange = () => {
      if ($("gout").value === "custom") return;
      const [w, h] = $("gout").value.split("x").map(Number);
      state.area.outW = w; state.area.outH = h;
      editor.requestDraw(); renderInspector();
    };
    $("gaspect").onchange = () => { state.area.aspect = $("gaspect").value; };
    $("gpaste").onchange = () => { state.area.paste = $("gpaste").value; };
    $("gfeather").onchange = () => { state.area.feather = Math.max(0, parseInt($("gfeather").value, 10) || 0); renderTags(); };
    $("gcontext").onchange = () => { state.area.context = Math.max(0, (parseFloat($("gcontext").value) || 0) / 100); renderTags(); };
    $("gcolor").onchange = () => { state.area.colorMatch = $("gcolor").checked; renderInspector(); };
    const full = $("btn-gen-full");
    if (full) full.onclick = () => {
      editor.gen = { x: 0, y: 0, w: editor.doc.w, h: editor.doc.h };
      editor.requestDraw();
      renderInspector();
    };
  }

  function renderTags() {
    const area = editor.maskArea();
    $("mask-tag").textContent = area > 8
      ? `Маска: ${state.brush.size}px · жёстк. ${Math.round(state.brush.hardness * 100)}% · ${area} px²`
      : "Маска: не нарисована · Q — кисть маски";
    const ctxPct = usesSource() ? Math.round(state.area.context * 100) : 0;
    $("context-tag").textContent = `Контекст +${ctxPct}% · растушёвка ${state.area.feather}px · ${state.area.paste}`;
  }

  function renderLayers() {
    const host = $("layer-list");
    const blend = $("layer-blend");
    if (blend && !blend.dataset.ready) {
      blend.innerHTML = BLENDS.map(([v, n]) => `<option value="${v}">${n}</option>`).join("");
      blend.dataset.ready = "1";
      blend.onchange = () => { const l = editor.activeLayer(); if (l && !l.locked) { l.blend = blend.value; editor.requestDraw(); renderLayers(); } };
      $("layer-opacity").onchange = () => {
        const l = editor.activeLayer(); if (!l || l.locked) return;
        const v = parseFloat(String($("layer-opacity").value).replace("%", ""));
        l.opacity = Math.min(1, Math.max(0, (v > 1 ? v / 100 : v)));
        editor.requestDraw(); renderLayers();
      };
    }
    const cur = editor.activeLayer();
    if (cur && blend) { blend.value = cur.blend; $("layer-opacity").value = Math.round(cur.opacity * 100) + "%"; }
    host.innerHTML = [...editor.layers].reverse().map((l) => {
      const idx = editor.layers.indexOf(l);
      const on = idx === editor.active;
      return `<div class="layer ${on ? "on" : ""}" data-layer="${l.id}">
        <button class="e ${l.visible ? "" : "off"}" data-eye="${l.id}" data-i="${l.visible ? "eye" : "eyeoff"}" data-s="15" type="button"></button>
        <div class="t">${l.thumb ? `<img src="${l.thumb}">` : ""}</div>
        <div class="n"><b>${escapeHtml(l.name)}</b><small>${l.blend} · ${Math.round(l.opacity * 100)}%${l.locked ? " · locked" : ""}${l.visible ? "" : " · hidden"}</small></div>
        <button data-lock="${l.id}" data-i="lock" data-s="13" type="button" style="color:${l.locked ? "var(--ac)" : "var(--mu)"}"></button>
      </div>`;
    }).join("") || `<div class="empty">Нет слоёв. Загрузите изображение или сгенерируйте.</div>`;
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(host);
  }

  let ppEditingId = null;

  function normalizePreset(p, i) {
    return {
      id: p.id || ("p" + Date.now().toString(36) + i),
      name: p.name || "Пресет",
      category: p.category || "Общее",
      text: p.text || "",
      position: p.position === "after" ? "after" : "before",
      enabled: !!p.enabled,
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

  function renderChips() {
    const active = activeOrdered();
    const count = $("pp-count");
    if (count) count.textContent = String(active.length);
    const host = $("pp-chips");
    if (!host) { updateFinal(); return; }
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
          <input type="checkbox" data-pp-on="${p.id}" ${p.enabled ? "checked" : ""}>
          <button type="button" class="nm" data-pp-edit="${p.id}">${escapeHtml(p.name)}</button>
          <button type="button" class="b s" data-pp-pos="${p.id}">${p.position === "after" ? "ПОСЛЕ" : "ДО"}</button>
          <button type="button" class="b s" data-pp-up="${p.id}" ${i <= 0 ? "disabled" : ""} title="Раньше среди активных">↑</button>
          <button type="button" class="b s" data-pp-down="${p.id}" ${i < 0 || i === active.length - 1 ? "disabled" : ""} title="Позже среди активных">↓</button>
          <button type="button" class="b s" data-pp-dup="${p.id}">Дубль</button>
          <button type="button" class="b s" data-pp-del="${p.id}">Удалить</button>
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
    $("token-est").textContent = "CONDITIONING · " + text.length + " симв.";
  }

  function renderPipe() {
    const c = cfg();
    const loras = activeLoras().filter((l) => l.enabled);
    const built = state.pipeline === "edit" ? "edit:" + (c.method || "inpaint") : "create";
    const steps = [
      { text: `Область ${state.area.outW}×${state.area.outH}`, color: "#4aa8ff" },
      { text: c.loader === "checkpoint" ? "Checkpoint" : "UNET + CLIP + VAE", color: "#ff7a1a" },
      { text: loras.length ? `LoRA ×${loras.length}` : "без LoRA", color: "#b18cff" },
      { text: "Промт + пресеты + LLM", color: "#e7c27a" },
      { text: `KSampler · ${state.sampler.steps} / ${state.sampler.cfg}`, color: "#3ddc97" },
      { text: built.startsWith("edit") ? "Бесшовная вклейка → новый слой" : "Генерация в область → новый слой", color: "#ff5c7a" },
    ];
    $("pipe-steps").innerHTML = steps.map((s, i) =>
      `<span class="pn" style="--c:${s.color}">${escapeHtml(s.text)}</span>` + (i < steps.length - 1 ? `<span class="pw" style="--c:${s.color}"></span>` : "")
    ).join("");
  }

  function renderPresetSelect() {
    const sel = $("preset-select");
    const cur = sel.value;
    sel.innerHTML = `<option value="">— без пресета —</option>` + state.presets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
    $("preset-count").textContent = String(state.presets.length);
  }

  function renderGallery() {
    const host = $("gal");
    let items = state.gallery.slice();
    const model = $("gal-model").value;
    const lora = $("gal-lora").value;
    if (model) items = items.filter((it) => (it.meta.model_label || it.meta.unet || "") === model);
    if (lora) items = items.filter((it) => (it.meta.loras || []).some((l) => l.name === lora));
    if ($("gal-sort").value === "old") items.reverse();
    const real = items.filter((it) => !it.example);
    const colors = { krea2_edit: "#ff7a1a", qwen_image_21: "#4aa8ff", create: "#b18cff" };
    if (!real.length) {
      const examples = ["portrait-copper.svg", "portrait-blond.svg", "portrait-blue.svg", "portrait.svg", "portrait-green.svg"];
      host.innerHTML = examples.map((s, i) => `<button type="button" class="g" data-example="1"><img src="assets/${s}"><s style="background:${["#ff7a1a","#b18cff","#4aa8ff","#7d8594","#3ddc97"][i]}"></s></button>`).join("");
      $("gal-legend").innerHTML = "<span>Примеры оформления, не генерации. После запуска здесь будут ваши кадры с сидом и промтом.</span>";
    } else {
      host.innerHTML = real.map((it) => {
        const col = colors[it.meta.edit_method] || colors[it.meta.pipeline] || "#7d8594";
        return `<button type="button" class="g" data-gal="${it.id}"><img src="/view?filename=${encodeURIComponent(it.file.split("/").pop())}&type=output&subfolder=zeroimagestudio/gallery"><s style="background:${col}"></s></button>`;
      }).join("");
      $("gal-legend").innerHTML = `<span><b style="color:#ff7a1a">▬</b> Krea Edit</span><span><b style="color:#b18cff">▬</b> Создание</span><span><b style="color:#4aa8ff">▬</b> Qwen</span>`;
    }
    $("gal-count").textContent = String(real.length);
    const models = [...new Set(state.gallery.map((it) => it.meta.model_label || it.meta.unet).filter(Boolean))];
    const loras = [...new Set(state.gallery.flatMap((it) => (it.meta.loras || []).map((l) => l.name)))];
    fillSelect($("gal-model"), ["", ...models], model, "Модель: все");
    fillSelect($("gal-lora"), ["", ...loras], lora, "LoRA: все");
  }

  function fillSelect(sel, values, current, placeholder) {
    const prev = current;
    sel.innerHTML = values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v || placeholder)}</option>`).join("");
    if ([...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
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
      inpaint_grow: c.inpaint_grow,
      qwen_resolution: parseInt(c.qwen_resolution, 10) || state.area.outW,
      krea: c.krea,
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
      width: state.area.outW,
      height: state.area.outH,
      filename_prefix: "zeroimagestudio/gen",
    };
  }

  function nextSeed() {
    if (state.sampler.seedMode === "random") state.sampler.seed = Math.floor(Math.random() * 1e9);
    else if (state.sampler.seedMode === "increment") state.sampler.seed = (Number(state.sampler.seed) + 1) >>> 0;
    const el = $("seed");
    if (el) el.value = state.sampler.seed;
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
    const proto = location.protocol === "https:" ? "wss" : "ws";
    ws = new WebSocket(`${proto}://${location.host}/ws?clientId=${clientId}`);
    ws.addEventListener("message", (ev) => {
      if (!wsWait) return;
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      wsWait(msg);
    });
    ws.addEventListener("close", () => setTimeout(connectWs, 1500));
  }

  function waitPrompt(promptId) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { wsWait = null; reject(new Error("Таймаут ожидания ComfyUI")); }, 30 * 60 * 1000);
      wsWait = (msg) => {
        const d = msg.data || {};
        if (d.prompt_id && d.prompt_id !== promptId) return;
        if (msg.type === "progress") {
          const pct = d.max ? Math.round(100 * d.value / d.max) : 0;
          $("gen-progress").style.display = "block";
          $("gen-progress").firstElementChild.style.width = pct + "%";
          $("gen-label").textContent = `Шаг ${d.value}/${d.max}`;
        }
        if (msg.type === "executing" && d.node) $("gen-label").textContent = "Узел " + d.node;
        if (msg.type === "execution_interrupted") {
          clearTimeout(timer); wsWait = null;
          reject(new Error("Генерация остановлена"));
        }
        if (msg.type === "execution_error") {
          clearTimeout(timer); wsWait = null;
          reject(new Error(d.exception_message || "Ошибка выполнения"));
        }
        if (msg.type === "execution_success" || (msg.type === "executing" && d.node == null && d.prompt_id === promptId)) {
          clearTimeout(timer); wsWait = null; resolve();
        }
      };
    });
  }

  async function generate() {
    if (state.running) { await fetch("/interrupt", { method: "POST" }); return; }
    state.running = true;
    $("btn-gen").classList.add("stop");
    $("gen-label").textContent = "Остановка…";
    $("btn-gen").querySelector("[data-i]") && ($("gen-label").textContent = "В очереди");
    try {
      nextSeed();
      const source = usesSource();
      const expand = source && state.pipeline === "edit" ? state.area.context : (editor.maskArea() > 8 ? state.area.context : 0);
      const crop = source ? editor.cropOf(expand) : null;
      const spec = specFromState();
      spec.has_mask = !!(crop && editor.maskArea() > 8);
      if (crop) {
        const scaled = scaleCanvas(crop.canvas, spec.width, spec.height);
        const scaledMask = scaleCanvas(crop.mask, spec.width, spec.height);
        spec.image = await uploadCanvas(scaled, "crop.png");
        if (spec.has_mask || state.pipeline === "edit") spec.mask = await uploadCanvas(scaledMask, "mask.png");
      }
      const refs = [];
      if (state.pipeline === "edit") {
        for (const ref of state.references) refs.push(await uploadCanvas(ref.canvas, "ref.png"));
      }
      spec.references = refs;
      const built = await api("/zeroimagestudio/build_workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(spec) });
      if (built.warnings && built.warnings.length) toast(built.warnings[0]);
      if (built.pipe) {
        $("pipe-steps").innerHTML = built.pipe.map((s, i) =>
          `<span class="pn" style="--c:${s.color}">${escapeHtml(s.text)}</span>` + (i < built.pipe.length - 1 ? `<span class="pw" style="--c:${s.color}"></span>` : "")
        ).join("");
      }
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
      if (crop) {
        try {
          const fd = new FormData();
          fd.append("result", blob, "result.png");
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
          pasted = await localFeather(blob, crop);
        }
      }
      const img = await loadImage(URL.createObjectURL(pasted));
      const snap = editor.fullSnapshot();
      const n = editor.layers.filter((l) => l.name.startsWith(state.pipeline === "edit" ? "Правка" : "Генерация")).length + 1;
      const label = state.pipeline === "edit" ? ("Правка " + n) : ("Генерация " + n);
      if (!crop) {
        const layerCanvas = scaleCanvas(img, editor.gen.w, editor.gen.h);
        const layer = editor.makeLayer(label, layerCanvas);
        layer.x = editor.gen.x; layer.y = editor.gen.y; layer.meta = meta;
        editor.addLayer(layer);
      } else {
        const c = document.createElement("canvas");
        c.width = img.width; c.height = img.height;
        c.getContext("2d").drawImage(img, 0, 0);
        const layer = editor.makeLayer(label, c);
        layer.x = crop.x; layer.y = crop.y; layer.meta = meta;
        editor.addLayer(layer);
      }
      editor.pushUndo(snap);
      toast("Готово, новый слой.");
    } catch (err) {
      toast(err.message || String(err));
    } finally {
      state.running = false;
      state.promptId = null;
      $("btn-gen").classList.remove("stop");
      $("gen-label").textContent = "Сгенерировать";
      $("gen-progress").style.display = "none";
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
      created: Math.floor(Date.now() / 1000),
    };
  }

  async function rememberGallery(blob, meta) {
    const fd = new FormData();
    fd.append("image", blob, "gen.png");
    fd.append("meta", JSON.stringify(meta));
    const saved = await api("/zeroimagestudio/gallery", { method: "POST", body: fd });
    state.gallery.unshift({ id: saved.id, file: saved.file, meta: saved.meta });
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
      back.innerHTML = `<div class="modal"><h3>Выберите вариант</h3><div class="gal" style="grid-template-columns:repeat(${Math.min(4, urls.length)},1fr)">${urls.map((u, i) => `<button class="g" data-i="${i}"><img src="${u}"></button>`).join("")}</div></div>`;
      back.addEventListener("click", (e) => {
        const b = e.target.closest("[data-i]");
        if (!b) return;
        back.remove();
        resolve(Number(b.dataset.i));
      });
      document.body.appendChild(back);
    });
  }

  async function saveProject() {
    const meta = editor.exportMeta();
    meta.state = {
      projectName: state.projectName, pipeline: state.pipeline, hintId: state.hintId,
      prompt: state.prompt, negative: state.negative, promptPresets: state.promptPresets,
      sampler: state.sampler, create: state.create, edit: state.edit, area: state.area, color: state.color, brush: state.brush,
    };
    const fd = new FormData();
    fd.append("meta", JSON.stringify(meta));
    fd.append("mask.png", await canvasBlob(editor.maskCanvas), "mask.png");
    for (const layer of editor.layers) fd.append("layers/" + layer.id + ".png", await canvasBlob(layer.canvas), layer.id + ".png");
    for (const ref of state.references) fd.append("refs/" + ref.id + ".png", await canvasBlob(ref.canvas), ref.id + ".png");
    const path = state.projectId ? "/zeroimagestudio/project/" + state.projectId : "/zeroimagestudio/project";
    const saved = await api(path, { method: "POST", body: fd });
    state.projectId = saved.id;
    $("project-sub").textContent = "ComfyUI · ZeroImageStudio · сохранено " + new Date().toLocaleTimeString();
    return saved.id;
  }

  async function loadProject(id) {
    const data = await api("/zeroimagestudio/project/" + id);
    const meta = data.meta || {};
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
    });
    state.hintId = canonicalHintId(state.hintId);
    state.hintByMode[state.pipeline] = state.hintId;
    if (Array.isArray(state.promptPresets)) state.promptPresets = state.promptPresets.map((p, i) => normalizePreset(p, i));
    editor.doc = meta.canvas || editor.doc;
    editor.gen = meta.gen || editor.gen;
    editor.resizeMask();
    editor.layers = [];
    for (const layer of meta.layers || []) {
      const img = await loadImage(`/zeroimagestudio/project/${id}/file/${layer.file}`);
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      const obj = editor.makeLayer(layer.name, c);
      Object.assign(obj, { id: layer.id, x: layer.x || 0, y: layer.y || 0, visible: layer.visible !== false, opacity: layer.opacity ?? 1, blend: layer.blend || "normal", locked: !!layer.locked, meta: layer.meta || null });
      editor.thumb(obj);
      editor.layers.push(obj);
    }
    if (meta.mask) {
      try {
        const img = await loadImage(`/zeroimagestudio/project/${id}/file/${meta.mask}`);
        editor.maskCtx.clearRect(0, 0, editor.doc.w, editor.doc.h);
        editor.maskCtx.drawImage(img, 0, 0);
      } catch { /* no mask */ }
    }
    state.references = [];
    for (const ref of meta.references || []) {
      const img = await loadImage(`/zeroimagestudio/project/${id}/file/${ref.file}`);
      const c = document.createElement("canvas");
      c.width = img.width; c.height = img.height;
      c.getContext("2d").drawImage(img, 0, 0);
      state.references.push({ id: ref.id, name: ref.name, canvas: c, url: c.toDataURL("image/png") });
    }
    editor.active = Math.max(0, editor.layers.length - 1);
    editor.fit();
    renderAll();
  }

  function placeImportedImage(img, name, fit) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    editor.pushUndo(editor.fullSnapshot());
    const demo = editor.layers.length === 1 && editor.layers[0].locked && editor.layers[0].name === "Оригинал";
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    c.getContext("2d").drawImage(img, 0, 0);
    if (fit) {
      editor.doc = { w, h };
      editor.resizeMask();
      editor.maskCtx.clearRect(0, 0, w, h);
      editor.gen = { x: Math.round(w * 0.12), y: Math.round(h * 0.08), w: Math.round(w * 0.76), h: Math.round(h * 0.7) };
    }
    const layer = editor.makeLayer(String(name || "Фото").replace(/\.[^.]+$/, ""), c);
    if (demo || !editor.layers.length) {
      editor.layers = [layer];
      editor.active = 0;
    } else {
      editor.addLayer(layer);
    }
    editor.thumb(layer);
    editor.fit();
    editor.requestDraw();
    renderLayers();
    renderInspector();
    toast(fit ? `Холст ${w} × ${h}. Слой в полном размере, без уменьшения.` : "Слой добавлен в полном размере, холст не менялся.");
  }

  function offerImportImage(img, name) {
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    return new Promise((resolve) => {
      const back = document.createElement("div");
      back.className = "modal-back";
      back.innerHTML = `<div class="modal"><h3>Открыть изображение</h3>
        <div class="mu">${escapeHtml(name || "изображение")} · ${w} × ${h}. Можно подогнать холст под полный размер. Пиксели не уменьшаются.</div>
        <div class="row" style="flex-wrap:wrap">
          <button class="b ac" type="button" data-fit="1">Подогнать холст</button>
          <button class="b" type="button" data-add="1">Добавить слоем</button>
          <button class="b" type="button" data-cancel="1">Отмена</button>
        </div></div>`;
      const close = (mode) => { back.remove(); resolve(mode); };
      back.querySelector("[data-fit]").onclick = () => close("fit");
      back.querySelector("[data-add]").onclick = () => close("add");
      back.querySelector("[data-cancel]").onclick = () => close(null);
      document.body.appendChild(back);
    }).then((mode) => { if (mode) placeImportedImage(img, name, mode === "fit"); });
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
    try {
      const id = await saveProject();
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
    } catch (err) {
      toast(err.message || String(err));
    }
  }

  function applyHint(h) {
    const pipes = hintPipelines(h);
    if (!pipes.includes(state.pipeline)) state.pipeline = pipes[0];
    state.hintId = canonicalHintId(h.id);
    state.hintByMode[state.pipeline] = state.hintId;
    const target = cfg();
    const d = h.defaults || {};
    ["loader", "clip_type", "weight_dtype", "latent_mode", "encoder", "unet", "clip", "vae", "checkpoint"].forEach((k) => {
      if (d[k] != null) target[k] = d[k];
    });
    if (state.pipeline === "edit" && h.edit_method) target.method = h.edit_method;
    if (h.qwen_resolution) target.qwen_resolution = h.qwen_resolution;
    if (h.krea) target.krea = { ...target.krea, ...h.krea };
    if (h.sampler) Object.assign(state.sampler, h.sampler);
    if (h.output) { state.area.outW = h.output[0]; state.area.outH = h.output[1]; }
    if (h.lora && h.lora.name) {
      const existing = target.loras.find((l) => l.name === h.lora.name);
      if (!existing) target.loras.push({ triggers: [], trigger_mode: "off", ...h.lora });
    }
    // keep suggested filenames only if installed; otherwise clear so the user sees the empty select
    const cat = state.catalog || {};
    if (target.unet && cat.unets && !cat.unets.includes(target.unet)) target.unet = "";
    if (target.clip && cat.clips && !cat.clips.includes(target.clip)) target.clip = "";
    if (target.vae && cat.vaes && !cat.vaes.includes(target.vae)) target.vae = "";
    if (target.checkpoint && cat.checkpoints && !cat.checkpoints.includes(target.checkpoint)) target.checkpoint = "";
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

  function showPop(it, anchor) {
    const pop = $("pop");
    const m = it.meta || {};
    const loras = (m.loras || []).map((l) => `${escapeHtml(l.name)} ${l.strength_model}`).join("<br>") || "—";
    pop.hidden = false;
    pop.innerHTML = `
      <div class="row" style="padding:8px 10px;border-bottom:1px solid #3a404c"><b>${escapeHtml(m.model_label || "Генерация")}</b><span class="mu mono" style="margin-left:auto;font-size:10.5px">${m.width || "?"}²</span></div>
      <div style="padding:8px 10px"><table>
        <tr><td>Модель</td><td>${escapeHtml(m.model_label || m.unet || m.checkpoint || "")}</td></tr>
        <tr><td>Seed</td><td class="mono">${m.seed ?? ""}</td></tr>
        <tr><td>Сэмплер</td><td class="mono">${escapeHtml(m.sampler || "")}/${escapeHtml(m.scheduler || "")} · ${m.steps} · CFG ${m.cfg}</td></tr>
        <tr><td>LoRA</td><td class="mono">${loras}</td></tr>
        <tr><td>Промт</td><td>${escapeHtml((m.final_prompt || m.prompt || "").slice(0, 180))}</td></tr>
      </table>
      <div class="row" style="margin-top:8px"><button class="b ac s" id="pop-apply" data-i="undo" data-s="12">Применить заново</button><button class="b s" id="pop-seed">Seed</button><button class="b s" id="pop-lora">LoRA</button></div></div>`;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(8, r.left - 280) + "px";
    pop.style.top = Math.max(8, r.bottom + 8) + "px";
    if (window.zeroImageStudioHydrateIcons) window.zeroImageStudioHydrateIcons(pop);
    $("pop-apply").onclick = () => { applyMeta(m); pop.hidden = true; document.body.dataset.tab = "canvas"; };
    $("pop-seed").onclick = () => { state.sampler.seed = m.seed || state.sampler.seed; renderSampler(); pop.hidden = true; };
    $("pop-lora").onclick = () => { if (m.loras) { cfg().loras = m.loras.map((l) => ({ enabled: true, strength_clip: l.strength_model, trigger_mode: "end", triggers: [], ...l })); renderLoras(); } pop.hidden = true; };
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
    openModal(`<h3>Настройки</h3>
      <div class="mu">Civitai API key (необязательно, для скрытых моделей)</div>
      <input id="set-civ" type="password" value="${escapeHtml(s.civitai_token || "")}">
      <div class="mu">LLM, OpenAI-совместимый адрес (Ollama, llama.cpp, LM Studio). Пример: http://127.0.0.1:11434/v1</div>
      <input id="set-base" type="text" value="${escapeHtml(s.llm_base || "")}">
      <div class="mu">Имя модели</div>
      <input id="set-model" type="text" value="${escapeHtml(s.llm_model || "")}" placeholder="qwen2.5:7b">
      <div class="mu">Ключ, если сервер его требует</div>
      <input id="set-key" type="password" value="${escapeHtml(s.llm_key || "")}">`, async (box, close) => {
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
    sel.innerHTML = `<option value="">Режим: текущий</option>` + items.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  }

  function openCanvasSize() {
    openModal(`<h3>Размер холста</h3>
      <div class="row"><input id="cw" class="f" value="${editor.doc.w}"><span>×</span><input id="ch" class="f" value="${editor.doc.h}"></div>
      <div class="mu">Новый холст очистит слои. «Применить» меняет только размер документа, пиксели слоёв остаются.</div>
      <button class="b" id="cw-new" type="button">Новый пустой холст</button>`, (box, close) => {
      box.querySelector("[data-ok]").onclick = () => {
        const w = Math.max(64, parseInt($("cw").value, 10) || editor.doc.w);
        const h = Math.max(64, parseInt($("ch").value, 10) || editor.doc.h);
        editor.pushUndo(editor.fullSnapshot());
        editor.doc = { w, h };
        editor.resizeMask();
        editor.gen.w = Math.min(editor.gen.w, w);
        editor.gen.h = Math.min(editor.gen.h, h);
        editor.fit();
        close();
      };
      $("cw-new").onclick = async () => {
        editor.pushUndo(editor.fullSnapshot());
        editor.layers = [];
        editor.doc = { w: parseInt($("cw").value, 10) || 1024, h: parseInt($("ch").value, 10) || 1024 };
        editor.resizeMask();
        editor.maskCtx.clearRect(0, 0, editor.doc.w, editor.doc.h);
        editor.fit();
        renderLayers();
        close();
      };
    });
  }

  function renderPresetPage() {
    const host = $("preset-page");
    if (!host) return;
    host.innerHTML = `<div class="row" style="align-items:flex-start;gap:16px">
      <div style="flex:1"><b>Пресеты генерации</b><div class="mu">Модель, LoRA, сэмплер, область. Холст не входит.</div>
        ${state.presets.map((p) => `<div class="row" style="margin-top:6px"><button class="b" data-load-preset="${p.id}">${escapeHtml(p.name)}</button><button class="b s" data-del-preset="${p.id}">удалить</button></div>`).join("") || `<div class="empty">Пока пусто. «Сохранить как» в шапке.</div>`}
      </div>
      <div style="flex:1"><b>Пресеты промта</b><div class="mu">Вставляются до или после текста только в момент генерации.</div>
        ${state.promptPresets.map((p) => `<div class="row" style="margin-top:6px"><span class="tag">${p.position === "after" ? "ПОСЛЕ" : "ДО"}</span><input class="f" style="flex:1" data-pp-name="${p.id}" value="${escapeHtml(p.name)}"><button class="b s" data-pp-del="${p.id}">×</button></div><textarea class="f" style="height:48px;width:100%;margin-top:4px" data-pp-text="${p.id}">${escapeHtml(p.text)}</textarea>`).join("")}
      </div></div>`;
  }

  function bindStatic() {
    document.querySelectorAll(".tabs button").forEach((b) => b.onclick = () => {
      document.querySelectorAll(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
      document.body.dataset.tab = b.dataset.tab;
      if (b.dataset.tab === "presets") renderPresetPage();
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
    $("prompt").oninput = () => { state.prompt = $("prompt").value; updateFinal(); };
    $("negative").oninput = () => { state.negative = $("negative").value; };
    $("project-name").onchange = () => { state.projectName = $("project-name").value || "zeroimagestudio"; };
    $("btn-gen").onclick = () => generate();
    $("btn-collapse").onclick = () => collapseZeroImageStudio();
    $("btn-focus").onclick = () => { if (window.parent !== window) window.parent.postMessage({ type: "zeroimagestudio-focus" }, "*"); else toast("Кнопка возвращает к ноде, когда ZeroImageStudio открыт из графа."); };
    $("btn-save").onclick = async () => { try { await saveProject(); const id = state.projectId; const a = document.createElement("a"); a.href = "/zeroimagestudio/project/" + id + "/export"; a.download = state.projectName + ".zip"; a.click(); toast("Проект сохранён и скачан."); } catch (err) { toast(err.message); } };
    $("btn-load").onclick = () => $("file-open").click();
    $("file-open").onchange = async () => {
      const file = $("file-open").files[0];
      if (!file) return;
      const fd = new FormData();
      fd.append("file", file);
      try {
        const data = await api("/zeroimagestudio/import_project", { method: "POST", body: fd });
        await loadProject(data.id);
        toast("Проект загружен.");
      } catch (err) { toast(err.message); }
    };
    $("btn-undo").onclick = () => editor.undo();
    $("btn-redo").onclick = () => editor.redo();
    $("btn-settings").onclick = () => openSettings();
    $("btn-system").onclick = () => openSystem();
    $("btn-canvas-size").onclick = () => openCanvasSize();
    $("btn-open-image").onclick = () => $("file-layer").click();
    $("brush-size").oninput = () => { state.brush.size = Number($("brush-size").value) || 1; renderTags(); };
    $("llm-improve").onclick = () => runLlm("improve");
    $("llm-extend").onclick = () => runLlm("extend");
    $("llm-describe").onclick = () => runLlm("describe");
    $("btn-save-preset").onclick = async () => {
      const name = window.prompt("Имя пресета", "Портрет HQ");
      if (!name) return;
      const item = await api("/zeroimagestudio/collection/presets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        name, pipeline: state.pipeline, hintId: state.hintId, prompt: state.prompt, negative: state.negative,
        promptPresets: state.promptPresets, sampler: state.sampler, create: state.create, edit: state.edit, area: state.area,
      }) });
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
      if (e.target.closest("[data-pp-open]")) { openPromptPop(); return; }
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
        state.references.push({ id: "r" + Math.random().toString(36).slice(2, 7), name: "#" + (state.references.length + 1), canvas: c, url: c.toDataURL("image/png") });
      }
      renderRefs();
    };
    $("file-layer").onchange = async () => {
      const file = $("file-layer").files[0];
      $("file-layer").value = "";
      if (!file) return;
      const img = await loadImage(URL.createObjectURL(file));
      await offerImportImage(img, file.name);
    };
    const stage = $("stage");
    stage.addEventListener("dragover", (e) => { e.preventDefault(); });
    stage.addEventListener("drop", async (e) => {
      e.preventDefault();
      const files = [...(e.dataTransfer && e.dataTransfer.files || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) return;
      const img = await loadImage(URL.createObjectURL(files[0]));
      await offerImportImage(img, files[0].name);
    });
    window.addEventListener("paste", async (e) => {
      if (e.target && /^(input|textarea|select)$/i.test(e.target.tagName)) return;
      const items = [...(e.clipboardData && e.clipboardData.items || [])];
      const file = items.map((item) => (item.kind === "file" ? item.getAsFile() : null)).find((f) => f && /^image\//.test(f.type));
      if (!file) return;
      e.preventDefault();
      const img = await loadImage(URL.createObjectURL(file));
      await offerImportImage(img, "Буфер обмена");
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
      const eye = e.target.closest("[data-eye]");
      const lock = e.target.closest("[data-lock]");
      const row = e.target.closest("[data-layer]");
      if (eye) {
        const l = editor.layers.find((x) => x.id === eye.dataset.eye);
        if (l) l.visible = !l.visible;
      } else if (lock) {
        const l = editor.layers.find((x) => x.id === lock.dataset.lock);
        if (l) l.locked = !l.locked;
      } else if (row) {
        editor.active = editor.layers.findIndex((x) => x.id === row.dataset.layer);
      } else return;
      editor.requestDraw();
      renderLayers();
    };
    $("layer-list").ondblclick = (e) => {
      const row = e.target.closest("[data-layer]");
      if (!row) return;
      const l = editor.layers.find((x) => x.id === row.dataset.layer);
      if (!l) return;
      const name = window.prompt("Имя слоя", l.name);
      if (name) { l.name = name; renderLayers(); }
    };
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
      editor.addLayer(copy);
    };
    $("btn-layer-del").onclick = () => editor.deleteActive();
    $("gal").onclick = (e) => {
      const ex = e.target.closest("[data-example]");
      if (ex) { toast("Это пример оформления, не результат генерации."); return; }
      const b = e.target.closest("[data-gal]");
      if (!b) return;
      const it = state.gallery.find((x) => x.id === b.dataset.gal);
      if (it) showPop(it, b);
    };
    $("gal-model").onchange = renderGallery;
    $("gal-lora").onchange = renderGallery;
    $("gal-sort").onchange = () => { $("gal-sort-label").textContent = "сортировка: " + ($("gal-sort").value === "old" ? "старые" : "новые"); renderGallery(); };
    document.addEventListener("click", (e) => { if (!$("pop").hidden && !e.target.closest("#pop") && !e.target.closest("[data-gal]")) $("pop").hidden = true; });
    $("preset-page").addEventListener("change", (e) => {
      const id = e.target.dataset.ppName || e.target.dataset.ppText;
      const p = state.promptPresets.find((x) => x.id === id);
      if (!p) return;
      if (e.target.dataset.ppName) p.name = e.target.value;
      if (e.target.dataset.ppText) p.text = e.target.value;
      renderChips();
    });
    $("preset-page").addEventListener("click", async (e) => {
      const load = e.target.closest("[data-load-preset]");
      const del = e.target.closest("[data-del-preset]");
      const pp = e.target.closest("[data-pp-del]");
      if (load) applyPreset(state.presets.find((p) => p.id === load.dataset.loadPreset));
      if (del) {
        await api("/zeroimagestudio/collection/presets/" + del.dataset.delPreset, { method: "DELETE" });
        state.presets = state.presets.filter((p) => p.id !== del.dataset.delPreset);
        renderPresetSelect(); renderPresetPage();
      }
      if (pp) { state.promptPresets = state.promptPresets.filter((p) => p.id !== pp.dataset.ppDel); renderChips(); renderPresetPage(); }
    });
    window.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); generate(); }
      if (e.key === "Escape") {
        if (!$("pp-pop").hidden) { closePromptPop(); return; }
        if (document.querySelector(".modal-back")) return;
        collapseZeroImageStudio();
      }
    });
    window.addEventListener("message", async (ev) => {
      const msg = ev.data || {};
      if (msg.type !== "zeroimagestudio-open") return;
      if (!booted) { pendingGraphOpen = msg; return; }
      await applyGraphOpen(msg);
    });
  }

  async function applyGraphOpen(msg) {
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
    }
    if (t.dataset.krea) c.krea[t.dataset.krea] = t.dataset.krea === "grounding_px" ? Number(t.value) : t.value;
    renderPipe();
    renderModelSummary();
    if (t.dataset.file === "method") renderRefs();
  }

  async function onLoraClick(e) {
    const folder = e.target.closest("[data-folder]");
    if (folder) { state.loraFolder = folder.dataset.folder; renderLoras(); return; }
    const toggle = e.target.closest("[data-lora-toggle]");
    if (toggle) {
      const name = toggle.dataset.loraToggle;
      const l = activeLoras().find((x) => x.name === name);
      if (l && l.enabled) l.enabled = false;
      else ensureLora(name).enabled = true;
      state.loraSelected = name;
      renderLoras(); renderPipe();
      return;
    }
    const row = e.target.closest("[data-lora]");
    if (row && !e.target.closest("[data-lora-toggle]")) { state.loraSelected = row.dataset.lora; renderLoras(); }
    const civ = e.target.closest("[data-civitai]");
    if (civ) {
      const l = activeLoras().find((x) => x.name === state.loraSelected);
      if (!l) return;
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
      const l = activeLoras().find((x) => x.name === state.loraSelected);
      if (!l || !l.triggers[trig.dataset.trig]) return;
      const t = l.triggers[trig.dataset.trig];
      t.enabled = t.enabled === false;
      renderLoras(); updateFinal();
    }
  }

  function onLoraChange(e) {
    const l = activeLoras().find((x) => x.name === state.loraSelected);
    if (!l) return;
    if (e.target.dataset.trigMode) { l.trigger_mode = e.target.value; updateFinal(); }
  }

  function onLoraInput(e) {
    const l = activeLoras().find((x) => x.name === state.loraSelected);
    if (!l) return;
    if (e.target.dataset.str) {
      const v = parseFloat(e.target.value);
      if (e.target.dataset.str === "model") l.strength_model = v; else l.strength_clip = v;
      const num = e.target.parentElement.querySelector("[data-str-num]");
      if (num) num.value = v.toFixed(2);
    }
    if (e.target.dataset.strNum) {
      const v = parseFloat(e.target.value) || 0;
      if (e.target.dataset.strNum === "model") l.strength_model = v; else l.strength_clip = v;
    }
  }

  let booted = false;
  let pendingGraphOpen = null;

  async function boot() {
    editor = new Editor($("stage"));
    bindStatic();
    connectWs();
    try {
      const [hints, models, loras, presets, gallery, settings, promptPresets] = await Promise.all([
        api("/zeroimagestudio/hints"), api("/zeroimagestudio/models"), api("/zeroimagestudio/loras"),
        api("/zeroimagestudio/collection/presets"), api("/zeroimagestudio/gallery"), api("/zeroimagestudio/settings"),
        api("/zeroimagestudio/collection/prompt_presets"),
      ]);
      state.hints = hints.hints || [];
      state.catalog = models;
      state.loras = loras.files || [];
      state.presets = presets.items || [];
      state.gallery = gallery.items || [];
      state.settings = settings;
      const storedPresets = (promptPresets && promptPresets.items) || [];
      if (storedPresets.length) state.promptPresets = storedPresets.map((p, i) => normalizePreset(p, i));
      else {
        state.promptPresets = state.promptPresets.map((p, i) => normalizePreset(p, i));
        for (const preset of state.promptPresets) await persistPreset(preset);
      }
      if (models.krea_import_error) toast("Встроенные ноды Krea 2 Edit не загрузились: " + models.krea_import_error);
      fillLlmPresets();
    } catch (err) {
      toast("ComfyUI API недоступен: " + err.message);
    }
    const params = new URLSearchParams(location.search);
    if (params.get("project")) {
      try { await loadProject(params.get("project")); } catch (err) { toast(err.message); await loadExample(); }
    } else {
      const hint = state.hints.find((h) => h.id === state.hintId);
      if (hint) applyHint(hint);
      await loadExample();
    }
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

  async function pollStats() {
    try {
      const [sys, queue] = await Promise.all([api("/system_stats"), api("/queue")]);
      const dev = (sys.devices && sys.devices[0]) || {};
      const total = dev.vram_total ? (dev.vram_total / 1024 / 1024 / 1024) : 0;
      const free = dev.vram_free ? (dev.vram_free / 1024 / 1024 / 1024) : 0;
      const used = total ? (total - free) : 0;
      const name = (dev.name || "CPU").replace("cuda:0 ", "");
      const pending = ((queue.queue_running || []).length + (queue.queue_pending || []).length);
      $("sys-stats").textContent = total
        ? `${name} · VRAM ${used.toFixed(1)}/${total.toFixed(0)} ГБ · очередь ${pending}`
        : `${name} · очередь ${pending}`;
    } catch { /* studio opened outside ComfyUI */ }
    setTimeout(pollStats, 4000);
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
