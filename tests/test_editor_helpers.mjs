import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const U = require("../web/zeroimagestudio_util.js");

test("escapeHtml encodes the characters that break markup", () => {
  assert.equal(U.escapeHtml(`<img src=x onerror=alert(1)>`), "&lt;img src=x onerror=alert(1)&gt;");
  assert.equal(U.escapeHtml(`"'&`), "&quot;&#39;&amp;");
  assert.equal(U.escapeHtml(null), "");
});

test("basename and file base accept Windows separators", () => {
  assert.equal(U.basenameOf("krea\\Krea2_Identity_Edit_v2.safetensors"), "krea2_identity_edit_v2.safetensors");
  assert.equal(U.basenameOf("krea/krea2_identity_edit_v2.safetensors"), "krea2_identity_edit_v2.safetensors");
  assert.equal(U.fileBase("krea\\File.PNG"), "File.PNG");
  assert.equal(U.normalizeSlashes("a\\b/c"), "a/b/c");
});

test("removal matches verbs and skips substrings", () => {
  assert.equal(U.requestsRemoval("удали лампу"), true);
  assert.equal(U.requestsRemoval("уберите это"), true);
  assert.equal(U.requestsRemoval("remove the lamp"), true);
  assert.equal(U.requestsRemoval("сотрудник"), false);
  assert.equal(U.requestsRemoval("убер"), false);
});

test("a selected mask is what the brush and the eraser paint", () => {
  assert.equal(U.brushTargetsMask("mask", false), true);
  assert.equal(U.brushTargetsMask("maskerase", false), true);
  assert.equal(U.workMaskRowVisible(false, "maskerase", null), true);
  assert.equal(U.brushTargetsMask("brush", true), true);
  assert.equal(U.brushTargetsMask("brush", false), false);
  assert.equal(U.brushTargetsMask("eraser", true), true);
  assert.equal(U.brushTargetsMask("eraser", false), false);
  assert.equal(U.workMaskRowVisible(false, "move", null), false);
  assert.equal(U.workMaskRowVisible(false, "mask", null), true);
  assert.equal(U.workMaskRowVisible(true, "brush", null), true);
  assert.equal(U.workMaskRowVisible(false, "brush", "work"), true);
  assert.equal(U.maskShortcutClears("d", true, null), "clear");
  assert.equal(U.maskShortcutClears("Delete", false, "work"), "clear");
  assert.equal(U.maskShortcutClears("Backspace", false, "work"), "clear");
  assert.equal(U.maskShortcutClears("Delete", false, null), "");
  assert.equal(U.maskShortcutClears("Delete", true, "work"), "");
  const inverse = U.inverseHistory(
    { type: "patch", id: "m", maskStroke: true, layerMaskId: "L1", x: 1, y: 2, w: 4, h: 4 },
    { data: { byteLength: 8 }, mask: null },
  );
  assert.equal(inverse.maskStroke, true);
  assert.equal(inverse.layerMaskId, "L1");
});

test("a saved task LoRA is not replaced by the suggested file", () => {
  const kept = U.resolveTaskLora(
    { name: "krea/general_edit_custom.safetensors", strength_model: 0.7, strength_clip: 0.4, enabled: false },
    "krea2_general_edit_v2.safetensors",
  );
  assert.equal(kept.name, "krea/general_edit_custom.safetensors");
  assert.equal(kept.strength_model, 0.7);
  assert.equal(kept.strength_clip, 0.4);
  assert.equal(kept.enabled, false);
  assert.equal(kept.remembered, true);
  const fresh = U.resolveTaskLora(null, "krea2_identity_edit_v2.safetensors");
  assert.equal(fresh.name, "krea2_identity_edit_v2.safetensors");
  assert.equal(fresh.strength_model, 1);
  assert.equal(fresh.remembered, false);
  assert.equal(U.resolveTaskLora({ name: "  " }, "suggested.safetensors").name, "suggested.safetensors");
});

test("the first image sets the canvas even after a manual blank size", () => {
  assert.equal(U.importPlacement(false, "fit"), "new");
  assert.equal(U.importPlacement(false, "grow"), "new");
  assert.equal(U.importPlacement(false, null), "new");
  assert.equal(U.importPlacement(true, "grow"), "grow");
  assert.equal(U.importPlacement(true, "fit"), "fit");
  assert.equal(U.importPlacement(true, null), "fit");
});

test("a preset without a category lands in Общее", () => {
  assert.equal(U.presetCategory({}), "Общее");
  assert.equal(U.presetCategory({ category: "  " }), "Общее");
  assert.equal(U.presetCategory({ category: "Портрет" }), "Портрет");
});

test("undo inverse is recorded for pixels, patches and moves", () => {
  const pixels = U.inverseHistory(
    { type: "pixels", id: "a", data: { byteLength: 4 } },
    { data: { byteLength: 8 }, mask: null },
  );
  assert.equal(pixels.type, "pixels");
  assert.equal(pixels.id, "a");
  assert.equal(pixels.data.byteLength, 8);
  const patch = U.inverseHistory(
    { type: "patch", id: "b" },
    { data: { byteLength: 12 }, mask: null },
  );
  assert.equal(patch.type, "patch");
  assert.equal(patch.data.byteLength, 12);
  assert.deepEqual(
    U.inverseHistory({ type: "move", id: "a", x: 1, y: 2 }, { x: 9, y: 8 }),
    { type: "move", id: "a", x: 9, y: 8 },
  );
  const full = U.inverseHistory({ type: "full" }, { full: { type: "full", layers: [] } });
  assert.equal(full.type, "full");
});

test("history bytes count image payloads", () => {
  const rec = { type: "pixels", data: { data: { byteLength: 100 } }, mask: { data: { byteLength: 40 } } };
  assert.equal(U.recordBytes(rec), 140);
  assert.equal(U.historyBytes([rec, rec]), 280);
});

test("ComfyUI validation errors name the node and the input", () => {
  const text = U.formatApiError({
    node_errors: {
      "4": {
        class_type: "KSampler",
        errors: [{ input: "seed", message: "Expected int" }],
      },
    },
  }, "Bad Request");
  assert.equal(text, "KSampler · seed: Expected int");
});

test("safe id strips markup", () => {
  assert.equal(U.safeId(`<script>alert(1)</script>`, "layer"), "scriptalert1script");
  assert.equal(U.finiteNumber("0", 7), 0);
  assert.equal(U.finiteNumber("nope", 7), 7);
});
