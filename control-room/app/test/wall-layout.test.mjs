import assert from "node:assert/strict";
import test from "node:test";

import { rewriteHeaders } from "../lib/proxy.mjs";
import {
  addTile,
  changeTile,
  clampTile,
  defaultCustom,
  DEFAULT_WALL,
  gridShape,
  moveId,
  orderIds,
  parseWall,
  removeTile,
  screenId,
  screenNumber,
} from "../public/wall-layout.js";

const IDS = ["s01", "s02", "s03", "s04", "s05", "s06"];

test("grid shapes and screen ids", () => {
  assert.deepEqual(gridShape(1), { cols: 1, rows: 1 });
  assert.deepEqual(gridShape("3"), { cols: 3, rows: 1 });
  assert.deepEqual(gridShape(4), { cols: 2, rows: 2 });
  assert.deepEqual(gridShape(6), { cols: 3, rows: 2 });
  assert.equal(screenId(3), "s03");
  assert.equal(screenNumber("s12"), 12);
});

test("order: saved first, unknown and duplicate ids dropped, new screens appended; drag moves", () => {
  assert.deepEqual(orderIds(IDS, ["s03", "s99", "s03", "s01"]), ["s03", "s01", "s02", "s04", "s05", "s06"]);
  assert.deepEqual(moveId(IDS, "s05", "s01"), ["s05", "s01", "s02", "s03", "s04", "s06"]);
  assert.deepEqual(moveId(IDS, "s01", "s01"), IDS);
});

test("custom board: tiles stay on the 12 x 12 board and at least 2 x 2", () => {
  assert.deepEqual(clampTile({ id: "s01", x: 11, y: -3, w: 1, h: 40 }), { id: "s01", x: 10, y: 0, w: 2, h: 12 });
  const even = defaultCustom(IDS);
  assert.equal(even.length, 6);
  assert.deepEqual(even[0], { id: "s01", x: 0, y: 0, w: 4, h: 6 });
  assert.deepEqual(even[5], { id: "s06", x: 8, y: 6, w: 4, h: 6 });
  const moved = changeTile(even, "s01", { dx: 20, dw: 2 });
  assert.deepEqual(moved.at(-1), { id: "s01", x: 6, y: 0, w: 6, h: 6 }, "moved tile comes to the front");
  assert.equal(addTile(removeTile(even, "s02"), "s02").at(-1).w, 4);
  assert.equal(addTile(even, "s01").length, 6, "no duplicate tile");
});

test("parseWall falls back to defaults on anything odd", () => {
  assert.deepEqual(parseWall("not json"), DEFAULT_WALL);
  assert.deepEqual(parseWall({ view: "9" }).view, "6");
  const w = parseWall(JSON.stringify({ view: "tabs", order: ["s02", "x", "<script>"], tab: "s02", custom: [{ id: "s01", x: 99, y: 0, w: 4, h: 4 }, { id: "bad" }] }));
  assert.equal(w.view, "tabs");
  assert.deepEqual(w.order, ["s02"]);
  assert.equal(w.tab, "s02");
  assert.deepEqual(w.custom, [{ id: "s01", x: 8, y: 0, w: 4, h: 4 }]);
});

test("screen responses: framing only by the Control Room, never a password prompt", () => {
  const out = rewriteHeaders({
    "X-Frame-Options": "DENY",
    "www-authenticate": 'Basic realm="x"',
    "content-security-policy": "default-src 'self'; frame-ancestors 'none'",
    connection: "keep-alive",
    "content-type": "text/html",
  });
  assert.equal(out["x-frame-options"], undefined);
  assert.equal(out["www-authenticate"], undefined);
  assert.equal(out.connection, undefined);
  assert.equal(out["content-security-policy"], "default-src 'self'; frame-ancestors 'self'");
  assert.equal(out["content-type"], "text/html");
  assert.equal(rewriteHeaders({})["content-security-policy"], "frame-ancestors 'self'");
});
