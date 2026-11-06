// TAKATAK Control Room — screen locks, camera presence and recording markers.
//
// One person controls a screen at a time. Taking a screen needs a live camera
// (when CAMERA_REQUIRED) and writes a marker file the screen's recorder watches:
// while the marker exists, the screen container records its display to
// /recordings/screens. A lock without a heartbeat expires and is released.

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { logEvent, tx } from "./db.mjs";

export function markerPath(recordingsDir, screen) {
  return join(recordingsDir, "control", `screen-${screen}.active`);
}

function writeMarker(recordingsDir, screen, username) {
  mkdirSync(join(recordingsDir, "control"), { recursive: true });
  writeFileSync(markerPath(recordingsDir, screen), `${username}\n`);
}

function removeMarker(recordingsDir, screen) {
  rmSync(markerPath(recordingsDir, screen), { force: true });
}

export function ensureScreens(db, count) {
  const insert = db.prepare("INSERT OR IGNORE INTO locks (screen) VALUES (?)");
  for (let n = 1; n <= count; n += 1) insert.run(n);
}

export function cameraLive(db, sessionHash, timeoutSeconds, now = Date.now()) {
  const row = db.prepare("SELECT last_chunk_at FROM camera WHERE session_hash = ?").get(sessionHash);
  return Boolean(row && now - row.last_chunk_at <= timeoutSeconds * 1000);
}

function isFresh(lock, timeoutSeconds, now) {
  return Boolean(lock?.username && lock.heartbeat_at && now - lock.heartbeat_at <= timeoutSeconds * 1000);
}

export function listScreens(db, config, me, now = Date.now()) {
  const rows = db.prepare("SELECT * FROM locks WHERE screen <= ? ORDER BY screen").all(config.screenCount);
  return rows.map((lock) => {
    const held = isFresh(lock, config.lockTimeoutSeconds, now);
    return {
      screen: lock.screen,
      adminLocked: Boolean(lock.admin_locked),
      holder: held ? lock.username : null,
      mine: held && lock.session_hash === me.idHash,
      since: held ? lock.acquired_at : null,
    };
  });
}

export function takeScreen(db, config, me, screen, now = Date.now()) {
  if (!Number.isInteger(screen) || screen < 1 || screen > config.screenCount) return { ok: false, status: 404, message: "Unknown screen." };
  if (config.cameraRequired && !cameraLive(db, me.idHash, config.cameraTimeoutSeconds, now)) {
    return { ok: false, status: 412, message: "Turn on your camera first: every session is recorded." };
  }
  return tx(db, () => {
    const lock = db.prepare("SELECT * FROM locks WHERE screen = ?").get(screen);
    if (lock.admin_locked) return { ok: false, status: 423, message: "This screen is locked by the administrator." };
    if (isFresh(lock, config.lockTimeoutSeconds, now) && lock.session_hash !== me.idHash) {
      return { ok: false, status: 409, message: `${lock.username} is working on this screen.` };
    }
    const renewing = lock.session_hash === me.idHash && isFresh(lock, config.lockTimeoutSeconds, now);
    db.prepare("UPDATE locks SET username = ?, session_hash = ?, acquired_at = ?, heartbeat_at = ? WHERE screen = ?").run(
      me.username,
      me.idHash,
      renewing ? lock.acquired_at : now,
      now,
      screen,
    );
    if (!renewing) {
      writeMarker(config.recordingsDir, screen, me.username);
      logEvent(db, { username: me.username, screen, type: "screen.taken", now });
    }
    return { ok: true };
  });
}

export function heartbeatScreen(db, config, me, screen, now = Date.now()) {
  const lock = db.prepare("SELECT * FROM locks WHERE screen = ?").get(screen);
  if (!lock || lock.session_hash !== me.idHash || !isFresh(lock, config.lockTimeoutSeconds, now)) {
    return { ok: false, status: 409, message: "You no longer control this screen." };
  }
  if (config.cameraRequired && !cameraLive(db, me.idHash, config.cameraTimeoutSeconds, now)) {
    releaseScreen(db, config, me, screen, { reason: "camera_lost", now });
    return { ok: false, status: 412, message: "Your camera stopped. The screen was released." };
  }
  db.prepare("UPDATE locks SET heartbeat_at = ? WHERE screen = ?").run(now, screen);
  return { ok: true };
}

export function releaseScreen(db, config, me, screen, { force = false, reason = "released", now = Date.now() } = {}) {
  return tx(db, () => {
    const lock = db.prepare("SELECT * FROM locks WHERE screen = ?").get(screen);
    if (!lock?.username) return { ok: true };
    if (!force && lock.session_hash !== me.idHash) return { ok: false, status: 403, message: "Only the person on the screen can release it." };
    db.prepare("UPDATE locks SET username = NULL, session_hash = NULL, acquired_at = NULL, heartbeat_at = NULL WHERE screen = ?").run(screen);
    removeMarker(config.recordingsDir, screen);
    logEvent(db, {
      username: me.username,
      screen,
      type: force ? "screen.force_released" : `screen.${reason}`,
      detail: force ? `was ${lock.username}` : null,
      now,
    });
    return { ok: true };
  });
}

export function setAdminLock(db, config, me, screen, locked, now = Date.now()) {
  if (locked) releaseScreen(db, config, me, screen, { force: true, now });
  db.prepare("UPDATE locks SET admin_locked = ? WHERE screen = ?").run(locked ? 1 : 0, screen);
  logEvent(db, { username: me.username, screen, type: locked ? "screen.admin_locked" : "screen.admin_unlocked", now });
  return { ok: true };
}

/** Releases locks without a heartbeat (closed tab, lost network) and removes their markers. */
export function sweepStaleLocks(db, config, now = Date.now()) {
  const stale = db
    .prepare("SELECT screen, username FROM locks WHERE username IS NOT NULL AND (heartbeat_at IS NULL OR heartbeat_at < ?)")
    .all(now - config.lockTimeoutSeconds * 1000);
  for (const lock of stale) {
    tx(db, () => {
      db.prepare("UPDATE locks SET username = NULL, session_hash = NULL, acquired_at = NULL, heartbeat_at = NULL WHERE screen = ?").run(lock.screen);
      removeMarker(config.recordingsDir, lock.screen);
      logEvent(db, { username: lock.username, screen: lock.screen, type: "screen.expired", now });
    });
  }
  // A marker must never outlive its lock (crash between DB and file writes).
  for (let n = 1; n <= config.screenCount; n += 1) {
    const lock = db.prepare("SELECT username FROM locks WHERE screen = ?").get(n);
    if (!lock?.username) removeMarker(config.recordingsDir, n);
  }
  return stale.length;
}

/** The screen a session may reach through the proxy, or null. */
export function canUseScreen(db, config, me, screen, now = Date.now()) {
  const lock = db.prepare("SELECT * FROM locks WHERE screen = ?").get(screen);
  return Boolean(lock && !lock.admin_locked && lock.session_hash === me.idHash && isFresh(lock, config.lockTimeoutSeconds, now));
}
