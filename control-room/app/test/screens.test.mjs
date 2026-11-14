import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { appendCameraChunk, listRecordings, safeRecordingPath } from "../lib/camera.mjs";
import {
  canUseScreen,
  ensureScreens,
  heartbeatScreen,
  listScreens,
  markerPath,
  releaseScreen,
  setAdminLock,
  sweepStaleLocks,
  takeScreen,
} from "../lib/screens.mjs";
import { setup } from "./helpers.mjs";

const sheroz = { username: "sheroz", idHash: "a".repeat(64) };
const abdullah = { username: "abdullah", idHash: "b".repeat(64) };
const takatak = { username: "takatak", idHash: "c".repeat(64) };

function room() {
  const ctx = setup();
  ensureScreens(ctx.db, ctx.config.screenCount);
  return ctx;
}

test("taking a screen needs a live camera; it starts the recording marker", () => {
  const ctx = room();
  const t = 1_000_000;
  assert.equal(takeScreen(ctx.db, ctx.config, sheroz, 1, t).status, 412);
  appendCameraChunk(ctx.db, ctx.config.recordingsDir, sheroz, Buffer.from("webm"), t);
  assert.equal(takeScreen(ctx.db, ctx.config, sheroz, 1, t).ok, true);
  assert.equal(readFileSync(markerPath(ctx.config.recordingsDir, 1), "utf8").trim(), "sheroz");
  assert.equal(canUseScreen(ctx.db, ctx.config, sheroz, 1, t), true);
  assert.equal(takeScreen(ctx.db, ctx.config, sheroz, 7, t).status, 404);

  appendCameraChunk(ctx.db, ctx.config.recordingsDir, abdullah, Buffer.from("webm"), t);
  const busy = takeScreen(ctx.db, ctx.config, abdullah, 1, t);
  assert.equal(busy.status, 409);
  assert.match(busy.message, /sheroz/);
  assert.equal(canUseScreen(ctx.db, ctx.config, abdullah, 1, t), false, "only the holder reaches the screen");
  const view = listScreens(ctx.db, ctx.config, abdullah, t);
  assert.equal(view[0].holder, "sheroz");
  assert.equal(view[0].mine, false);
  assert.equal(view.length, 6);
});

test("losing the camera or the heartbeat frees the screen and stops the recording", () => {
  const ctx = room();
  const t = 1_000_000;
  appendCameraChunk(ctx.db, ctx.config.recordingsDir, sheroz, Buffer.from("x"), t);
  takeScreen(ctx.db, ctx.config, sheroz, 2, t);
  assert.equal(heartbeatScreen(ctx.db, ctx.config, sheroz, 2, t + 30_000).ok, true);
  const noCamera = heartbeatScreen(ctx.db, ctx.config, sheroz, 2, t + 60_000);
  assert.equal(noCamera.status, 412);
  assert.equal(existsSync(markerPath(ctx.config.recordingsDir, 2)), false);

  appendCameraChunk(ctx.db, ctx.config.recordingsDir, sheroz, Buffer.from("x"), t + 61_000);
  takeScreen(ctx.db, ctx.config, sheroz, 3, t + 61_000);
  assert.equal(sweepStaleLocks(ctx.db, ctx.config, t + 61_000 + 120_000), 1, "no heartbeat for 90 s");
  assert.equal(existsSync(markerPath(ctx.config.recordingsDir, 3)), false);
  assert.equal(canUseScreen(ctx.db, ctx.config, sheroz, 3, t + 200_000), false);
  const events = ctx.db.prepare("SELECT type FROM events ORDER BY id").all().map((e) => e.type);
  assert.ok(events.includes("screen.camera_lost") && events.includes("screen.expired"));
});

test("release, forced release and administrator lock", () => {
  const ctx = room();
  const t = 1_000_000;
  for (const who of [sheroz, abdullah]) appendCameraChunk(ctx.db, ctx.config.recordingsDir, who, Buffer.from("x"), t);
  takeScreen(ctx.db, ctx.config, sheroz, 4, t);
  assert.equal(releaseScreen(ctx.db, ctx.config, abdullah, 4, { now: t }).status, 403);
  assert.equal(releaseScreen(ctx.db, ctx.config, takatak, 4, { force: true, now: t }).ok, true);
  assert.equal(canUseScreen(ctx.db, ctx.config, sheroz, 4, t), false);
  setAdminLock(ctx.db, ctx.config, takatak, 5, true, t);
  assert.equal(takeScreen(ctx.db, ctx.config, abdullah, 5, t).status, 423);
  setAdminLock(ctx.db, ctx.config, takatak, 5, false, t);
  assert.equal(takeScreen(ctx.db, ctx.config, abdullah, 5, t).ok, true);
});

test("webcam chunks append to one file per session; recording paths cannot escape", () => {
  const ctx = room();
  const t = Date.UTC(2026, 10, 6, 12);
  appendCameraChunk(ctx.db, ctx.config.recordingsDir, sheroz, Buffer.from("part1"), t);
  appendCameraChunk(ctx.db, ctx.config.recordingsDir, sheroz, Buffer.from("part2"), t + 5000);
  const files = listRecordings(ctx.config.recordingsDir);
  assert.equal(files.length, 1);
  assert.match(files[0].path, /^webcam\/sheroz\/2026-11-06\/.+\.webm$/);
  assert.equal(readFileSync(safeRecordingPath(ctx.config.recordingsDir, files[0].path), "utf8"), "part1part2");
  assert.equal(appendCameraChunk(ctx.db, ctx.config.recordingsDir, sheroz, Buffer.alloc(0), t).status, 400);
  for (const bad of ["../data/control-room.sqlite3", "webcam/../../etc/passwd.webm", "/etc/passwd", "control/screen-1.active", "screens/a.txt"]) {
    assert.equal(safeRecordingPath(ctx.config.recordingsDir, bad), null, bad);
  }
});
