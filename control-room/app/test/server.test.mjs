import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import test from "node:test";

import { completeSetup, prepareAccount } from "../lib/auth.mjs";
import { createServer } from "../server.mjs";
import { setup } from "./helpers.mjs";

const PASSWORD = "a-long-family-password";

/** A fake screen: records requests, answers HTTP, and accepts a WebSocket that echoes. */
function fakeScreen() {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, headers: req.headers });
    res.writeHead(200, { "content-type": "text/plain", "www-authenticate": 'Basic realm="x"' });
    res.end(`screen ok ${req.url}`);
  });
  server.on("upgrade", (req, socket) => {
    seen.push({ url: req.url, headers: req.headers, upgrade: true });
    const accept = createHash("sha1").update(`${req.headers["sec-websocket-key"]}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest("base64");
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.on("data", (d) => socket.write(d));
  });
  return { server, seen };
}

async function listen(server) {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server.address().port;
}

async function start() {
  const screen = fakeScreen();
  const screenPort = await listen(screen.server);
  const ctx = setup({ SCREEN_URL_TEMPLATE: `http://127.0.0.1:${screenPort}` });
  const app = createServer({ config: ctx.config, db: ctx.db, sms: ctx.sms });
  const port = await listen(app);
  const base = `http://127.0.0.1:${port}`;
  for (const [username, phone] of [["sheroz", "+15145550100"], ["takatak", "+15145550101"]]) {
    const token = prepareAccount(ctx.db, { username, email: `${username}@example.test`, phone });
    completeSetup(ctx.db, { token, password: PASSWORD });
  }
  return { ...ctx, app, screen, base, port, close: () => { app.close(); screen.server.close(); } };
}

async function login(t, username = "sheroz") {
  const headers = { "content-type": "application/json", origin: t.base };
  const r1 = await fetch(`${t.base}/api/login`, { method: "POST", headers, body: JSON.stringify({ username, password: PASSWORD }) });
  assert.equal(r1.status, 200);
  assert.match((await r1.json()).phone, /010[01]$/);
  const pending = r1.headers.get("set-cookie").split(";")[0];
  assert.match(r1.headers.get("set-cookie"), /HttpOnly; SameSite=Strict/);
  const r2 = await fetch(`${t.base}/api/verify`, { method: "POST", headers: { ...headers, cookie: pending }, body: JSON.stringify({ code: t.codes.at(-1) }) });
  assert.equal(r2.status, 200);
  const session = r2.headers.getSetCookie().find((c) => c.startsWith("cr_session=")).split(";")[0];
  return { cookie: session, origin: t.base, "content-type": "application/json" };
}

test("pages need a session; POSTs need the same origin", async () => {
  const t = await start();
  try {
    const home = await fetch(`${t.base}/`, { redirect: "manual" });
    assert.equal(home.status, 302);
    assert.equal(home.headers.get("location"), "/login");
    const login = await fetch(`${t.base}/login`);
    assert.match(login.headers.get("content-security-policy"), /script-src 'self'/);
    const noOrigin = await fetch(`${t.base}/api/login`, { method: "POST", body: "{}" });
    assert.equal(noOrigin.status, 403);
    const evil = await fetch(`${t.base}/api/login`, { method: "POST", headers: { origin: "https://evil.example" }, body: "{}" });
    assert.equal(evil.status, 403);
    const me = await fetch(`${t.base}/api/me`);
    assert.equal(me.status, 401);
  } finally {
    t.close();
  }
});

test("a screen is reachable only by its holder; the screen password never reaches the browser", async () => {
  const t = await start();
  try {
    const headers = await login(t);
    const denied = await fetch(`${t.base}/s01/`, { headers });
    assert.equal(denied.status, 403, "not taken yet");

    const noCam = await fetch(`${t.base}/api/screens/1/take`, { method: "POST", headers, body: "{}" });
    assert.equal(noCam.status, 412);
    const cam = await fetch(`${t.base}/api/camera`, { method: "POST", headers: { cookie: headers.cookie, origin: t.base }, body: Buffer.from("webm-bytes") });
    assert.equal(cam.status, 200);
    const take = await fetch(`${t.base}/api/screens/1/take`, { method: "POST", headers, body: "{}" });
    assert.equal(take.status, 200);

    const bare = await fetch(`${t.base}/s01?x=1`, { headers, redirect: "manual" });
    assert.equal(bare.status, 301);
    assert.equal(bare.headers.get("location"), "/s01/?x=1");

    const page = await fetch(`${t.base}/s01/index.html?x=1`, { headers });
    assert.equal(page.status, 200);
    assert.match(page.headers.get("content-security-policy"), /frame-ancestors 'self'/, "embeddable by the Control Room only");
    assert.equal(await page.text(), "screen ok /s01/index.html?x=1");
    assert.equal(page.headers.get("www-authenticate"), null);
    const upstream = t.screen.seen.at(-1);
    assert.equal(upstream.headers.authorization, `Basic ${Buffer.from("abc:screen-password-for-tests").toString("base64")}`);
    assert.equal(upstream.headers.cookie, undefined, "the session cookie stays here");

    assert.equal((await fetch(`${t.base}/s02/`, { headers })).status, 403, "other screens stay closed");

    // WebSocket through the tunnel.
    const echoed = await new Promise((resolve, reject) => {
      const socket = net.connect(t.port, "127.0.0.1", () => {
        socket.write(
          `GET /s01/websocket HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\nCookie: ${headers.cookie}\r\n\r\n`,
        );
      });
      let buffer = "";
      socket.on("data", (d) => {
        buffer += d.toString();
        if (buffer.includes("101 Switching Protocols") && !buffer.includes("ping")) socket.write("ping");
        if (buffer.endsWith("ping")) {
          socket.destroy();
          resolve(buffer);
        }
      });
      socket.on("error", reject);
      setTimeout(() => reject(new Error("timeout")), 3000);
    });
    assert.match(echoed, /101 Switching Protocols/);

    const anonymousWs = await new Promise((resolve) => {
      const socket = net.connect(t.port, "127.0.0.1", () => socket.write("GET /s01/websocket HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"));
      socket.on("data", (d) => resolve(d.toString()));
    });
    assert.match(anonymousWs, /403/);

    const release = await fetch(`${t.base}/api/screens/1/release`, { method: "POST", headers, body: "{}" });
    assert.equal(release.status, 200);
    assert.equal((await fetch(`${t.base}/s01/`, { headers })).status, 403);

    const note = await fetch(`${t.base}/api/notes`, { method: "POST", headers, body: JSON.stringify({ text: "Client X: draft done", screen: 1 }) });
    assert.equal(note.status, 200);
    const notes = await (await fetch(`${t.base}/api/notes`, { headers })).json();
    assert.equal(notes.notes[0].text, "Client X: draft done");

    assert.equal((await fetch(`${t.base}/api/events`, { headers })).status, 403, "journal and recordings: administrator only");
    assert.equal((await fetch(`${t.base}/recordings/webcam/x.webm`, { headers })).status, 403);
  } finally {
    t.close();
  }
});

test("shared wall layout: everyone reads it, only the administrator shares it", async () => {
  const t = await start();
  try {
    const sheroz = await login(t);
    const empty = await (await fetch(`${t.base}/api/layout`, { headers: sheroz })).json();
    assert.equal(empty.wall, null);
    const wall = { view: "custom", order: ["s02", "s01"], tab: "s02", custom: [{ id: "s01", x: 0, y: 0, w: 6, h: 12 }] };
    const denied = await fetch(`${t.base}/api/layout`, { method: "PUT", headers: sheroz, body: JSON.stringify({ wall }) });
    assert.equal(denied.status, 403);

    const admin = await login(t, "takatak");
    const shared = await fetch(`${t.base}/api/layout`, { method: "PUT", headers: admin, body: JSON.stringify({ wall }) });
    assert.equal(shared.status, 200);
    const read = await (await fetch(`${t.base}/api/layout`, { headers: sheroz })).json();
    assert.equal(read.wall.view, "custom");
    assert.deepEqual(read.wall.order, ["s02", "s01"]);
    assert.deepEqual(read.wall.custom, [{ id: "s01", x: 0, y: 0, w: 6, h: 12 }]);
  } finally {
    t.close();
  }
});
