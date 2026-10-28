import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const UX = require("../web/zeroimagestudio_ux.js");

test("create references stay LLM-only and Krea character uses the first card", () => {
  assert.equal(UX.refBadge({ pipeline: "create" }, 0).label, "Только для LLM");
  assert.equal(UX.refBadge({ pipeline: "edit", method: "krea2_edit", task: "general" }, 0).used, false);
  const person = UX.refBadge({ pipeline: "edit", method: "krea2_edit", task: "identity" }, 0);
  const extra = UX.refBadge({ pipeline: "edit", method: "krea2_edit", task: "identity" }, 1);
  assert.equal(person.label, "Человек");
  assert.equal(extra.label, "Не используется");
  assert.equal(extra.used, false);
  assert.match(UX.refStatus({ pipeline: "create", count: 2 }).line, /Только для LLM/);
});

test("placement defaults and an explicit choice wins", () => {
  assert.equal(UX.resultPlacement("create", true, ""), "replace");
  assert.equal(UX.resultPlacement("edit", true, ""), "layer");
  assert.equal(UX.resultPlacement("create", true, "layer"), "layer");
});

test("Krea locks denoise at 1 and a maskless img2img shows 0.75", () => {
  const krea = UX.effectiveDenoise({ method: "krea2_edit", denoise: 0.4 });
  assert.equal(krea.value, 1);
  assert.equal(krea.locked, true);
  const img = UX.effectiveDenoise({ method: "inpaint", hasMask: false, denoise: 1 });
  assert.equal(img.value, 0.75);
  assert.match(img.note, /0\.75/);
  assert.equal(UX.showNegative(1), false);
  assert.equal(UX.showNegative(1.1), true);
});

test("Krea vision reports the grounding crop and where the reference sits", () => {
  const beside = UX.kreaVision({ srcW: 2000, srcH: 1000, grounding: 768, position: "beside (right of target)", outW: 1024, outH: 1024 });
  assert.equal(beside.cropW, 768);
  assert.equal(beside.cropH, 384);
  assert.equal(beside.beside, true);
  assert.equal(beside.finalW, 1024);
  const aligned = UX.kreaVision({ srcW: 512, srcH: 512, grounding: 1024, position: "aligned (trained)", outW: 512, outH: 512 });
  assert.equal(aligned.place, "поверх кадра");
  assert.equal(aligned.cropW, 512);
});

test("a single installed file fills an empty slot and does not replace a choice", () => {
  assert.equal(UX.singleFile("", ["only.safetensors"]), "only.safetensors");
  assert.equal(UX.singleFile("", ["a.safetensors", "b.safetensors"]), "");
  assert.equal(UX.singleFile("mine.safetensors", ["only.safetensors"]), "mine.safetensors");
});

test("a disabled generate lists what is missing", () => {
  const items = UX.blockItems({ pipeline: "edit", method: "inpaint", prompt: "", scene: false, loader: "diffusion", unet: "", clip: "c", vae: "", missingLora: true });
  assert.ok(items.includes("нет промта"));
  assert.ok(items.includes("нет изображения"));
  assert.ok(items.includes("нет UNET"));
  assert.ok(items.includes("нет VAE"));
  assert.ok(items.includes("нет LoRA"));
  assert.equal(items.includes("нет CLIP"), false);
});
