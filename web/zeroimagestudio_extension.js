import { app } from "../../scripts/app.js";

const STYLE = `
.comfy-zeroimagestudio-card{font:12px/1.35 "Segoe UI",sans-serif;color:#d9dde5;display:flex;flex-direction:column;gap:8px;padding:4px 2px 8px;height:100%;box-sizing:border-box}
.comfy-zeroimagestudio-card .row{display:flex;gap:8px}
.comfy-zeroimagestudio-card img.preview{width:132px;height:168px;object-fit:cover;border-radius:4px;background:#0e1013;border:1px solid #2c313b}
.comfy-zeroimagestudio-card .meta{font-size:12px;display:flex;flex-direction:column;gap:4px;min-width:0}
.comfy-zeroimagestudio-card .meta b{font-weight:650}
.comfy-zeroimagestudio-card .meta span{color:#7d8594}
.comfy-zeroimagestudio-card button.expand{height:36px;border:0;border-radius:6px;background:#2f6bff;color:#fff;font-weight:800;cursor:pointer}
.comfy-zeroimagestudio-card .hint{color:#7d8594;font-size:10.5px;text-align:center}
`;

const hooked = new WeakSet();

function hideWidget(widget) {
  if (!widget) return;
  widget.hidden = true;
  widget.computeSize = () => [0, -4];
  if (widget.element) widget.element.style.display = "none";
}

function widget(node, name) {
  return (node.widgets || []).find((w) => w.name === name);
}

function linkedImage(node) {
  try {
    const slot = node.findInputSlot && node.findInputSlot("image");
    if (slot == null || slot < 0) return {};
    const input = node.inputs && node.inputs[slot];
    if (!input || input.link == null) return {};
    const link = app.graph && app.graph.links && app.graph.links[input.link];
    if (!link) return { imageLinked: true };
    const src = app.graph.getNodeById(link.origin_id);
    if (!src) return { imageLinked: true };
    const imageWidget = (src.widgets || []).find((w) => w.name === "image" || w.name === "filename");
    if (imageWidget && imageWidget.value) {
      let name = String(imageWidget.value);
      let type = "input";
      const bracket = name.match(/^(.*) \[(\w+)\]$/);
      if (bracket) { name = bracket[1]; type = bracket[2]; }
      return { imageUrl: `/view?filename=${encodeURIComponent(name)}&type=${encodeURIComponent(type)}` };
    }
    const outputs = app.nodeOutputs && app.nodeOutputs[src.id];
    const img = outputs && outputs.images && outputs.images[0];
    if (img && img.filename) {
      return {
        imageUrl: `/view?filename=${encodeURIComponent(img.filename)}&type=${encodeURIComponent(img.type || "output")}&subfolder=${encodeURIComponent(img.subfolder || "")}`,
      };
    }
    return { imageLinked: true };
  } catch (err) {
    return {};
  }
}

function openZeroImageStudio(node) {
  let overlay = document.getElementById("comfy-zeroimagestudio-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "comfy-zeroimagestudio-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:#000";
    const frame = document.createElement("iframe");
    frame.id = "comfy-zeroimagestudio-frame";
    frame.style.cssText = "width:100%;height:100%;border:0;background:#121418";
    frame.src = new URL("./zeroimagestudio.html", import.meta.url).href;
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    window.addEventListener("message", (ev) => onMessage(ev, frame));
  }
  overlay.style.display = "block";
  overlay.dataset.node = String(node.id);
  const frame = overlay.querySelector("iframe");
  const send = () => {
    frame.contentWindow.postMessage({
      type: "zeroimagestudio-open",
      projectId: widget(node, "zeroimagestudio_project")?.value || "",
      nodeId: node.id,
      ...linkedImage(node),
    }, "*");
  };
  if (frame.dataset.ready === "1") send();
  else frame.addEventListener("load", () => { frame.dataset.ready = "1"; send(); }, { once: true });
  frame._zisNode = node;
}

function onMessage(ev, frame) {
  const msg = ev.data || {};
  if (msg.type === "zeroimagestudio-ready") {
    frame.dataset.ready = "1";
    if (frame._zisNode) {
      frame.contentWindow.postMessage({
        type: "zeroimagestudio-open",
        projectId: widget(frame._zisNode, "zeroimagestudio_project")?.value || "",
        nodeId: frame._zisNode.id,
        ...linkedImage(frame._zisNode),
      }, "*");
    }
  }
  if (msg.type === "zeroimagestudio-collapse" || msg.type === "zeroimagestudio-focus") {
    const node = frame._zisNode;
    const overlay = document.getElementById("comfy-zeroimagestudio-overlay");
    if (msg.type === "zeroimagestudio-collapse" && node) {
      const image = widget(node, "zeroimagestudio_image");
      const mask = widget(node, "zeroimagestudio_mask");
      const layers = widget(node, "zeroimagestudio_layers");
      const project = widget(node, "zeroimagestudio_project");
      if (image) image.value = msg.image || "";
      if (mask) mask.value = msg.mask || "";
      if (layers) layers.value = msg.layers || "";
      if (project) project.value = msg.projectId || "";
      const img = node._zisPreview;
      if (img && msg.preview) img.src = msg.preview;
      const meta = node._zisMeta;
      if (meta && msg.info) {
        const doc = msg.info.doc || {};
        meta.replaceChildren();
        const title = document.createElement("b");
        title.textContent = msg.name || "ZeroImageStudio";
        const layers = document.createElement("span");
        layers.textContent = "Слои: " + (Number(msg.info.layers) || 0);
        const size = document.createElement("span");
        size.textContent = "Холст " + (Number(doc.w) || 0) + " × " + (Number(doc.h) || 0);
        const preset = document.createElement("span");
        preset.textContent = msg.info.preset || "";
        meta.append(title, layers, size, preset);
      }
    }
    if (overlay) overlay.style.display = "none";
    app.canvas?.setDirty(true, true);
  }
}

function setupNode(node) {
  if (!node || node.comfyClass !== "ZeroImageStudio" || hooked.has(node)) return;
  hooked.add(node);
  for (const name of ["zeroimagestudio_image", "zeroimagestudio_mask", "zeroimagestudio_layers", "zeroimagestudio_project"]) hideWidget(widget(node, name));
  if (!document.getElementById("comfy-zeroimagestudio-style")) {
    const style = document.createElement("style");
    style.id = "comfy-zeroimagestudio-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const card = document.createElement("div");
  card.className = "comfy-zeroimagestudio-card";
  card.innerHTML = `
    <div class="row">
      <img class="preview" alt="">
      <div class="meta"><b>Проект</b><span>Слои: —</span><span>Пресет</span><span>Холст</span></div>
    </div>
    <button type="button" class="expand">Развернуть ZeroImageStudio</button>
    <div class="hint">Полноэкранный редактор поверх ComfyUI · Esc — свернуть</div>`;
  node._zisPreview = card.querySelector("img");
  node._zisMeta = card.querySelector(".meta");
  card.querySelector("button").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openZeroImageStudio(node);
  });
  try {
    node.addDOMWidget("zeroimagestudio_card", "div", card, {
      getValue() { return ""; },
      setValue() {},
      getMinHeight() { return 230; },
      serialize: false,
    });
  } catch (err) {
    node.addWidget("button", "Развернуть ZeroImageStudio", null, () => openZeroImageStudio(node));
  }
  node.setSize([420, Math.max(node.size?.[1] || 0, 320)]);
  node.color = "#3a4d86";
  node.bgcolor = "#1b1e24";
}

app.registerExtension({
  name: "comfyui.zeroimagestudio",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "ZeroImageStudio") return;
    const created = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = created?.apply(this, arguments);
      setupNode(this);
      return result;
    };
  },
  nodeCreated(node) {
    setupNode(node);
  },
});
