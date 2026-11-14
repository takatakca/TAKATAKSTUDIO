// TAKATAK Control Room — the webcam recording of whoever is connected.
// The browser records the camera (MediaRecorder, WebM) and uploads a chunk
// every few seconds; chunks are appended to one file per login session in
// /recordings/webcam/<user>/<day>/.

import { appendFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export const MAX_CHUNK_BYTES = 8 * 1024 * 1024;

function stamp(now) {
  return new Date(now).toISOString().replace(/[:.]/g, "-");
}

export function appendCameraChunk(db, recordingsDir, me, chunk, now = Date.now()) {
  if (!chunk.length) return { ok: false, status: 400, message: "Empty chunk." };
  if (chunk.length > MAX_CHUNK_BYTES) return { ok: false, status: 413, message: "Chunk too large." };
  let row = db.prepare("SELECT file FROM camera WHERE session_hash = ?").get(me.idHash);
  if (!row) {
    const day = new Date(now).toISOString().slice(0, 10);
    const file = join("webcam", me.username, day, `${stamp(now)}_${me.idHash.slice(0, 8)}.webm`);
    db.prepare("INSERT INTO camera (session_hash, username, file, started_at, last_chunk_at, bytes) VALUES (?, ?, ?, ?, ?, 0)").run(
      me.idHash,
      me.username,
      file,
      now,
      now,
    );
    row = { file };
  }
  const absolute = join(recordingsDir, row.file);
  mkdirSync(join(absolute, ".."), { recursive: true });
  appendFileSync(absolute, chunk);
  db.prepare("UPDATE camera SET last_chunk_at = ?, bytes = bytes + ? WHERE session_hash = ?").run(now, chunk.length, me.idHash);
  return { ok: true };
}

/** Lists recordings (screens + webcam), newest first, as paths relative to the recordings dir. */
export function listRecordings(recordingsDir, limit = 500) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "control") walk(full);
      } else if (/\.(mp4|webm)$/.test(entry.name)) {
        const info = statSync(full);
        out.push({ path: relative(recordingsDir, full).split(sep).join("/"), bytes: info.size, modifiedAt: info.mtimeMs });
      }
    }
  };
  walk(recordingsDir);
  return out.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
}

/** Resolves a recording path inside the recordings dir, or null (no traversal). */
export function safeRecordingPath(recordingsDir, requested) {
  if (typeof requested !== "string" || !/^(screens|webcam)\/[A-Za-z0-9._/-]+\.(mp4|webm)$/.test(requested)) return null;
  const root = resolve(recordingsDir);
  const full = resolve(root, requested);
  return full.startsWith(root + sep) ? full : null;
}
