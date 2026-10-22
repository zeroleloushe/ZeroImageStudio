import assert from "node:assert/strict";
import test from "node:test";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const size = require("../web/zeroimagestudio_size.js");

test("linked whole-canvas size follows the document, not a stale output box", () => {
  const doc = { w: 832, h: 1216 };
  const area = { outputLinked: true, userPlaced: false, outW: 1024, outH: 1024 };
  const status = size.areaStatusText(doc, area);
  const label = size.areaLabelText({ w: 832, h: 1216 }, doc, area);
  assert.equal(status, "весь холст → 832×1216");
  assert.equal(label, "Весь холст 832×1216 → 832×1216");
  assert.equal(status.split("→ ")[1], label.split("→ ")[1]);
  assert.equal(size.generationFrame(doc, area).w, 832);
  assert.equal(size.generationFrame(doc, area).h, 1216);
});

test("a placed area keeps its own output size", () => {
  const doc = { w: 832, h: 1216 };
  const area = { outputLinked: true, userPlaced: true, outW: 1024, outH: 1024 };
  assert.equal(size.areaStatusText(doc, area), "область → 1024×1024");
  assert.equal(size.areaLabelText({ w: 400, h: 300 }, doc, area), "Область 400×300 → 1024×1024");
});

test("an unlinked whole canvas uses the stored output size", () => {
  const doc = { w: 832, h: 1216 };
  const area = { outputLinked: false, userPlaced: false, outW: 640, outH: 960 };
  assert.equal(size.areaStatusText(doc, area), "весь холст → 640×960");
});

test("snap rounds to 16 and never below 64", () => {
  assert.equal(size.snapSize(830), 832);
  assert.equal(size.snapSize(1024), 1024);
  assert.equal(size.snapSize(8), 64);
});

test("a wide crop keeps its aspect inside the generation budget", () => {
  const frame = size.frameForRegion(200, 100, 1024, 1024);
  assert.ok(Math.abs(frame.w / frame.h - 2) < 0.08);
  const placed = size.containRect(200, 100, frame.w, frame.h);
  assert.ok(placed.w <= frame.w && placed.h <= frame.h);
  assert.ok(placed.x >= 0 && placed.y >= 0);
  assert.ok(placed.w === frame.w || placed.h === frame.h);
});
