import { app } from "../../scripts/app.js";

const STYLE = `
.comfy-studio-card{font:12px/1.35 "Segoe UI",sans-serif;color:#d9dde5;display:flex;flex-direction:column;gap:8px;padding:4px 2px 8px;height:100%;box-sizing:border-box}
.comfy-studio-card .row{display:flex;gap:8px}
.comfy-studio-card img.preview{width:132px;height:168px;object-fit:cover;border-radius:4px;background:#0e1013;border:1px solid #2c313b}
.comfy-studio-card .meta{font-size:12px;display:flex;flex-direction:column;gap:4px;min-width:0}
.comfy-studio-card .meta b{font-weight:650}
.comfy-studio-card .meta span{color:#7d8594}
.comfy-studio-card button.expand{height:36px;border:0;border-radius:6px;background:#2f6bff;color:#fff;font-weight:800;cursor:pointer}
.comfy-studio-card .hint{color:#7d8594;font-size:10.5px;text-align:center}
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

function openStudio(node) {
  let overlay = document.getElementById("comfy-studio-overlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "comfy-studio-overlay";
    overlay.style.cssText = "position:fixed;inset:0;z-index:100000;background:#000";
    const frame = document.createElement("iframe");
    frame.id = "comfy-studio-frame";
    frame.style.cssText = "width:100%;height:100%;border:0;background:#121418";
    frame.src = new URL("./studio.html", import.meta.url).href;
    overlay.appendChild(frame);
    document.body.appendChild(overlay);
    window.addEventListener("message", (ev) => onMessage(ev, frame));
  }
  overlay.style.display = "block";
  overlay.dataset.node = String(node.id);
  const frame = overlay.querySelector("iframe");
  const send = () => {
    frame.contentWindow.postMessage({
      type: "studio-open",
      projectId: widget(node, "studio_project")?.value || "",
      nodeId: node.id,
    }, "*");
  };
  if (frame.dataset.ready === "1") send();
  else frame.addEventListener("load", () => { frame.dataset.ready = "1"; send(); }, { once: true });
  frame._studioNode = node;
}

function onMessage(ev, frame) {
  const msg = ev.data || {};
  if (msg.type === "studio-ready") {
    frame.dataset.ready = "1";
    if (frame._studioNode) {
      frame.contentWindow.postMessage({
        type: "studio-open",
        projectId: widget(frame._studioNode, "studio_project")?.value || "",
        nodeId: frame._studioNode.id,
      }, "*");
    }
  }
  if (msg.type === "studio-collapse" || msg.type === "studio-focus") {
    const node = frame._studioNode;
    const overlay = document.getElementById("comfy-studio-overlay");
    if (msg.type === "studio-collapse" && node) {
      const image = widget(node, "studio_image");
      const mask = widget(node, "studio_mask");
      const layers = widget(node, "studio_layers");
      const project = widget(node, "studio_project");
      if (image) image.value = msg.image || "";
      if (mask) mask.value = msg.mask || "";
      if (layers) layers.value = msg.layers || "";
      if (project) project.value = msg.projectId || "";
      const img = node._studioPreview;
      if (img && msg.preview) img.src = msg.preview;
      const meta = node._studioMeta;
      if (meta && msg.info) {
        meta.innerHTML = `<b>${msg.name || "Studio"}</b><span>Слои: ${msg.info.layers}</span><span>Холст ${msg.info.doc.w} × ${msg.info.doc.h}</span><span>${msg.info.preset || ""}</span>`;
      }
    }
    if (overlay) overlay.style.display = "none";
    app.canvas?.setDirty(true, true);
  }
}

function setupNode(node) {
  if (!node || node.comfyClass !== "Studio" || hooked.has(node)) return;
  hooked.add(node);
  for (const name of ["studio_image", "studio_mask", "studio_layers", "studio_project"]) hideWidget(widget(node, name));
  if (!document.getElementById("comfy-studio-style")) {
    const style = document.createElement("style");
    style.id = "comfy-studio-style";
    style.textContent = STYLE;
    document.head.appendChild(style);
  }
  const card = document.createElement("div");
  card.className = "comfy-studio-card";
  card.innerHTML = `
    <div class="row">
      <img class="preview" alt="">
      <div class="meta"><b>Проект</b><span>Слои: —</span><span>Пресет</span><span>Холст</span></div>
    </div>
    <button type="button" class="expand">Развернуть студию</button>
    <div class="hint">Полноэкранный редактор поверх ComfyUI · Esc — свернуть</div>`;
  node._studioPreview = card.querySelector("img");
  node._studioMeta = card.querySelector(".meta");
  card.querySelector("button").addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    openStudio(node);
  });
  try {
    node.addDOMWidget("studio_card", "div", card, {
      getValue() { return ""; },
      setValue() {},
      getMinHeight() { return 230; },
      serialize: false,
    });
  } catch (err) {
    node.addWidget("button", "Развернуть студию", null, () => openStudio(node));
  }
  node.setSize([420, Math.max(node.size?.[1] || 0, 320)]);
  node.color = "#3a4d86";
  node.bgcolor = "#1b1e24";
}

app.registerExtension({
  name: "comfyui.studio",
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== "Studio") return;
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
