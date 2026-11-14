// TAKATAK Control Room — web server (Node 22, no third-party dependency).
// Login (password + SMS code) for the 3 accounts, the screen grid, locks,
// webcam recording, journal/notes, recordings list, and the authorized
// pass-through to the 6 screen containers.

import { createReadStream, readFileSync, statSync } from "node:fs";
import http from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { completeSetup, endSession, finishLogin, getSession, startLogin } from "./lib/auth.mjs";
import { appendCameraChunk, listRecordings, MAX_CHUNK_BYTES, safeRecordingPath } from "./lib/camera.mjs";
import { loadConfig } from "./lib/config.mjs";
import { logEvent, openDb } from "./lib/db.mjs";
import { proxyHttp, proxyUpgrade } from "./lib/proxy.mjs";
import {
  canUseScreen,
  ensureScreens,
  heartbeatScreen,
  listScreens,
  releaseScreen,
  setAdminLock,
  sweepStaleLocks,
  takeScreen,
} from "./lib/screens.mjs";
import { createSms, maskPhone } from "./lib/sms.mjs";
import { parseWall } from "./public/wall-layout.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml" };
const PAGE_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'";

export function createServer({ config, db, sms, now = () => Date.now() }) {
  ensureScreens(db, config.screenCount);
  const tunnels = new Map(); // screen -> Set(close)
  const isSupervisor = (me) => config.supervisors.includes(me.username);

  const closeTunnels = (screen) => {
    for (const close of tunnels.get(screen) ?? []) close();
    tunnels.delete(screen);
  };

  const cookieOptions = (maxAgeSeconds) =>
    `Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${config.cookieSecure ? "; Secure" : ""}`;

  function cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie ?? "").split(";")) {
      const i = part.indexOf("=");
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function clientIp(req) {
    const forwarded = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    return forwarded.at(-1) ?? req.socket.remoteAddress ?? null;
  }

  function sameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return false;
    if (config.publicOrigin) return origin === config.publicOrigin;
    return origin === `http://${req.headers.host}` || origin === `https://${req.headers.host}`;
  }

  function send(res, status, body, headers = {}) {
    res.writeHead(status, { "cache-control": "no-store", ...headers });
    res.end(body);
  }
  const json = (res, status, body) => send(res, status, JSON.stringify(body), { "content-type": "application/json; charset=utf-8" });

  function readBody(req, limit) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (chunk) => {
        size += chunk.length;
        if (size > limit) {
          reject(Object.assign(new Error("too_large"), { status: 413 }));
          req.destroy();
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  async function readJson(req) {
    const body = await readBody(req, 16 * 1024);
    try {
      return JSON.parse(body.toString("utf8") || "{}");
    } catch {
      throw Object.assign(new Error("bad_json"), { status: 400 });
    }
  }

  function page(res, name) {
    const html = readFileSync(join(PUBLIC_DIR, name));
    send(res, 200, html, {
      "content-type": TYPES[".html"],
      "content-security-policy": PAGE_CSP,
      "x-frame-options": "SAMEORIGIN",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "permissions-policy": "camera=(self), microphone=(self)",
    });
  }

  function asset(res, name) {
    if (!/^[a-z0-9-]+\.(js|css|svg)$/.test(name)) return send(res, 404, "Not found");
    try {
      const body = readFileSync(join(PUBLIC_DIR, name));
      send(res, 200, body, { "content-type": TYPES[extname(name)], "x-content-type-options": "nosniff" });
    } catch {
      send(res, 404, "Not found");
    }
  }

  function streamRecording(req, res, full) {
    let size;
    try {
      size = statSync(full).size;
    } catch {
      return send(res, 404, "Not found");
    }
    const type = full.endsWith(".mp4") ? "video/mp4" : "video/webm";
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ""));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (start >= size || start > end) return send(res, 416, "", { "content-range": `bytes */${size}` });
      res.writeHead(206, { "content-type": type, "content-length": end - start + 1, "content-range": `bytes ${start}-${end}/${size}`, "accept-ranges": "bytes", "cache-control": "no-store" });
      return createReadStream(full, { start, end }).pipe(res);
    }
    res.writeHead(200, { "content-type": type, "content-length": size, "accept-ranges": "bytes", "cache-control": "no-store" });
    createReadStream(full).pipe(res);
  }

  async function handle(req, res) {
    const url = new URL(req.url, "http://local");
    const path = url.pathname;
    const jar = cookies(req);
    const me = getSession(db, jar.cr_session, now());

    // Screens: authorized pass-through only.
    const screenMatch = /^\/s(\d{2})(\/|$)/.exec(path);
    if (screenMatch) {
      const screen = Number(screenMatch[1]);
      if (!screenMatch[2]) return send(res, 301, "", { location: `/s${screenMatch[1]}/${url.search}` });
      if (!me || !canUseScreen(db, config, me, screen, now())) return send(res, 403, "Take this screen in the Control Room first.");
      return proxyHttp(req, res, config, screen);
    }

    if (req.method === "GET") {
      if (path === "/healthz") return json(res, 200, { ok: true });
      if (path === "/") return me ? page(res, "index.html") : send(res, 302, "", { location: "/login" });
      if (path === "/login") return page(res, "login.html");
      if (path === "/setup") return page(res, "setup.html");
      if (path.startsWith("/assets/")) return asset(res, path.slice("/assets/".length));
      if (path.startsWith("/recordings/")) {
        if (!me || !isSupervisor(me)) return send(res, 403, "Forbidden");
        const full = safeRecordingPath(config.recordingsDir, decodeURIComponent(path.slice("/recordings/".length)));
        if (!full) return send(res, 404, "Not found");
        logEvent(db, { username: me.username, type: "recording.viewed", detail: path.slice(12), now: now() });
        return streamRecording(req, res, full);
      }
    }

    if (!path.startsWith("/api/")) return send(res, 404, "Not found");
    if (req.method === "POST" && !sameOrigin(req)) return json(res, 403, { ok: false, message: "Request refused (origin)." });

    // Public API: setup and login.
    if (req.method === "POST" && path === "/api/setup") {
      const body = await readJson(req);
      const result = completeSetup(db, { token: body.token, password: body.password, now: now() });
      return json(res, result.ok ? 200 : 400, result);
    }
    if (req.method === "POST" && path === "/api/login") {
      const body = await readJson(req);
      const result = await startLogin(db, sms, { username: body.username, password: body.password, ip: clientIp(req), now: now() });
      if (!result.ok) return json(res, result.status, { ok: false, message: result.message });
      return send(res, 200, JSON.stringify({ ok: true, phone: maskPhone(result.phone) }), {
        "content-type": "application/json; charset=utf-8",
        "set-cookie": `cr_pending=${encodeURIComponent(result.pendingId)}; ${cookieOptions(600)}`,
      });
    }
    if (req.method === "POST" && path === "/api/verify") {
      const body = await readJson(req);
      const result = await finishLogin(db, sms, {
        pendingId: jar.cr_pending,
        code: body.code,
        ip: clientIp(req),
        userAgent: req.headers["user-agent"],
        sessionHours: config.sessionHours,
        now: now(),
      });
      if (!result.ok) return json(res, result.status, { ok: false, message: result.message });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": [`cr_session=${encodeURIComponent(result.sessionId)}; ${cookieOptions(config.sessionHours * 3600)}`, `cr_pending=; ${cookieOptions(0)}`],
      });
      return res.end(JSON.stringify({ ok: true }));
    }

    if (!me) return json(res, 401, { ok: false, message: "Log in first." });

    if (req.method === "POST" && path === "/api/logout") {
      for (const row of db.prepare("SELECT screen FROM locks WHERE session_hash = ?").all(me.idHash)) closeTunnels(row.screen);
      endSession(db, jar.cr_session, now());
      return send(res, 200, JSON.stringify({ ok: true }), { "content-type": "application/json; charset=utf-8", "set-cookie": `cr_session=; ${cookieOptions(0)}` });
    }
    if (req.method === "GET" && path === "/api/me") {
      return json(res, 200, { ok: true, username: me.username, supervisor: isSupervisor(me), screenCount: config.screenCount, cameraRequired: config.cameraRequired });
    }
    if (req.method === "GET" && path === "/api/screens") return json(res, 200, { ok: true, screens: listScreens(db, config, me, now()) });

    const action = /^\/api\/screens\/(\d{1,2})\/(take|heartbeat|release|admin-lock)$/.exec(path);
    if (req.method === "POST" && action) {
      const screen = Number(action[1]);
      if (screen < 1 || screen > config.screenCount) return json(res, 404, { ok: false, message: "Unknown screen." });
      let result;
      if (action[2] === "take") result = takeScreen(db, config, me, screen, now());
      else if (action[2] === "heartbeat") result = heartbeatScreen(db, config, me, screen, now());
      else if (action[2] === "release") {
        const body = await readJson(req);
        const force = body.force === true;
        if (force && !isSupervisor(me)) return json(res, 403, { ok: false, message: "Only the administrator can free someone else's screen." });
        result = releaseScreen(db, config, me, screen, { force, now: now() });
      } else {
        if (!isSupervisor(me)) return json(res, 403, { ok: false, message: "Administrator only." });
        const body = await readJson(req);
        result = setAdminLock(db, config, me, screen, body.locked === true, now());
      }
      if (!canUseScreen(db, config, me, screen, now())) {
        // Whoever no longer holds the screen loses its open streams.
        const lock = db.prepare("SELECT session_hash FROM locks WHERE screen = ?").get(screen);
        if (!lock?.session_hash) closeTunnels(screen);
      }
      return json(res, result.ok ? 200 : result.status, result);
    }

    if (req.method === "POST" && path === "/api/camera") {
      const chunk = await readBody(req, MAX_CHUNK_BYTES);
      const result = appendCameraChunk(db, config.recordingsDir, me, chunk, now());
      return json(res, result.ok ? 200 : result.status, result);
    }

    if (path === "/api/notes") {
      if (req.method === "GET") {
        return json(res, 200, { ok: true, notes: db.prepare("SELECT id, at, username, screen, text FROM notes ORDER BY at DESC LIMIT 200").all() });
      }
      if (req.method === "POST") {
        const body = await readJson(req);
        const text = String(body.text ?? "").trim().slice(0, 2000);
        const screen = Number.isInteger(body.screen) && body.screen >= 1 && body.screen <= config.screenCount ? body.screen : null;
        if (!text) return json(res, 400, { ok: false, message: "Write a note first." });
        db.prepare("INSERT INTO notes (at, username, screen, text) VALUES (?, ?, ?, ?)").run(now(), me.username, screen, text);
        return json(res, 200, { ok: true });
      }
    }

    if (path === "/api/layout") {
      // The wall layout shared with every device (Food Hub "Share layout"); each device keeps its own otherwise.
      if (req.method === "GET") {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'wall'").get();
        return json(res, 200, { ok: true, wall: row ? parseWall(row.value) : null });
      }
      if (req.method === "PUT") {
        if (!sameOrigin(req)) return json(res, 403, { ok: false, message: "Request refused (origin)." });
        if (!isSupervisor(me)) return json(res, 403, { ok: false, message: "Administrator only." });
        const body = await readJson(req);
        const wall = parseWall(body.wall);
        db.prepare(
          "INSERT INTO settings (key, value, updated_by, updated_at) VALUES ('wall', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
        ).run(JSON.stringify(wall), me.username, now());
        logEvent(db, { username: me.username, type: "layout.shared", now: now() });
        return json(res, 200, { ok: true, wall });
      }
    }

    if (req.method === "GET" && path === "/api/events") {
      if (!isSupervisor(me)) return json(res, 403, { ok: false, message: "Administrator only." });
      return json(res, 200, { ok: true, events: db.prepare("SELECT id, at, username, screen, type, detail FROM events ORDER BY id DESC LIMIT 300").all() });
    }
    if (req.method === "GET" && path === "/api/recordings") {
      if (!isSupervisor(me)) return json(res, 403, { ok: false, message: "Administrator only." });
      return json(res, 200, { ok: true, recordings: listRecordings(config.recordingsDir) });
    }

    return json(res, 404, { ok: false, message: "Not found." });
  }

  const server = http.createServer((req, res) => {
    handle(req, res).catch((error) => {
      const status = error.status ?? 500;
      if (status === 500) console.error("[control-room]", error.message);
      if (!res.headersSent) json(res, status, { ok: false, message: status === 500 ? "Server error." : error.message });
      else res.end();
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const match = /^\/s(\d{2})\//.exec(new URL(req.url, "http://local").pathname);
    const me = getSession(db, cookies(req).cr_session, now());
    const screen = match ? Number(match[1]) : 0;
    if (!match || !me || !canUseScreen(db, config, me, screen, now())) {
      socket.end("HTTP/1.1 403 Forbidden\r\n\r\n");
      return;
    }
    const close = proxyUpgrade(req, socket, head, config, screen);
    if (!tunnels.has(screen)) tunnels.set(screen, new Set());
    tunnels.get(screen).add(close);
    socket.on("close", () => tunnels.get(screen)?.delete(close));
  });

  const sweep = () => {
    const before = new Set(db.prepare("SELECT screen FROM locks WHERE username IS NOT NULL").all().map((r) => r.screen));
    sweepStaleLocks(db, config, now());
    for (const screen of before) {
      if (!db.prepare("SELECT username FROM locks WHERE screen = ?").get(screen)?.username) closeTunnels(screen);
    }
  };
  const timer = setInterval(sweep, 15_000);
  timer.unref();
  server.on("close", () => clearInterval(timer));
  server.sweep = sweep;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { config, problems } = loadConfig();
  if (problems.length) {
    for (const problem of problems) console.error(`[control-room] ${problem}`);
    process.exit(1);
  }
  const db = openDb(join(config.dataDir, "control-room.sqlite3"));
  const sms = createSms(config);
  const server = createServer({ config, db, sms });
  server.listen(config.port, () => console.log(`[control-room] listening on ${config.port} (${config.screenCount} screens, SMS ${sms.mode})`));
}
