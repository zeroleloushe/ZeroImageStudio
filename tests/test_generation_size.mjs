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

test("megapixels follow the frame aspect and the model step", () => {
  const frame = size.sizeForMegapixels(800, 1200, 1, 16);
  assert.equal(frame.w % 16, 0);
  assert.equal(frame.h % 16, 0);
  assert.ok(Math.abs(frame.w / frame.h - 800 / 1200) < 0.05);
  assert.ok(Math.abs(frame.w * frame.h - 1e6) / 1e6 < 0.08);
});

test("9:16 at 1 MP keeps the named 768×1344 and drops 752×1344", () => {
  const list = size.resolutionCatalog("9:16", 16, 1);
  assert.ok(list.some((item) => item.w === 768 && item.h === 1344));
  assert.equal(list.some((item) => item.w === 752 && item.h === 1344), false);
  assert.ok(list.every((item) => item.w % 16 === 0 && item.h % 16 === 0));
});

test("canvas snap crops a few pixels and does not grow the image", () => {
  const cropped = size.cropSizeToStep(1000, 1500, 16);
  assert.equal(cropped.w, 992);
  assert.equal(cropped.h, 1488);
  assert.ok(cropped.w <= 1000 && cropped.h <= 1500);
  const fit = size.containInside(800, 1600, 1024, 1024);
  assert.equal(fit.w, 512);
  assert.equal(fit.h, 1024);
  assert.equal(fit.x, 256);
  assert.equal(fit.y, 0);
  const small = size.containInside(400, 200, 1024, 1024);
  assert.equal(small.w, 400);
  assert.equal(small.h, 200);
});

test("a dragged frame snaps position and size to the model step", () => {
  const snapped = size.snapRect({ x: 10, y: 12, w: 100, h: 90 }, 16, { w: 1024, h: 1024 });
  assert.equal(snapped.x % 16, 0);
  assert.equal(snapped.y % 16, 0);
  assert.equal(snapped.w % 16, 0);
  assert.equal(snapped.h % 16, 0);
  assert.ok(snapped.w >= 16 && snapped.h >= 16);
  assert.ok(snapped.x + snapped.w <= 1024);
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

test("context padding grows the crop past the frame and the preview maps back onto it", () => {
  const frame = { x: 50, y: 40, w: 200, h: 100 };
  const crop = size.contextRect(frame, 1000, 1000, 0.15);
  assert.deepEqual(crop, { x: 20, y: 25, w: 260, h: 130 });
  const edge = size.contextRect({ x: 0, y: 0, w: 200, h: 100 }, 220, 1000, 0.15);
  assert.equal(edge.x, 0);
  assert.ok(edge.w <= 220);
  const placed = { x: 20, y: 0, w: 240, h: 120 };
  const mapped = size.previewMap(crop, 280, 120, placed);
  assert.ok(mapped.x < crop.x);
  assert.ok(mapped.w > crop.w);
  assert.equal(Math.round(mapped.y), crop.y);
});

test("inside a frame moves it, a handle resizes it, and outside starts a new one", () => {
  const frame = { x: 100, y: 80, w: 200, h: 160 };
  assert.equal(size.frameGesture(180, 140, frame, 1, { frameTool: true }), "move");
  assert.equal(size.frameGesture(100, 80, frame, 1, { frameTool: true }), "nw");
  assert.equal(size.frameGesture(20, 20, frame, 1, { frameTool: true }), "new");
  assert.equal(size.frameGesture(200, 80, frame, 1, { frameTool: true }), "n");
  assert.equal(size.frameGesture(180, 140, frame, 1, { paint: true }), "paint");
  assert.equal(size.frameGesture(180, 140, frame, 1, { paint: true, alt: true }), "move");
  assert.equal(size.FRAME_HANDLES[size.frameGesture(300, 240, frame, 2, { frameTool: true })], 1);
  assert.equal(size.frameGesture(100 - 8, 160, frame, 2, { frameTool: true }), "new");
  assert.equal(size.frameGesture(100 - 8, 160, frame, 1, { frameTool: true }), "w");
});
