// TAKATAK Control Room — pass-through to the screen containers.
// /s01/ … /s06/ (as on the Food Hub screens) is forwarded to that screen's web desktop (HTTP and
// WebSocket) only for the session holding the screen's lock. The screen's
// own basic-auth password is added here, so it never reaches a browser.

import http from "node:http";
import net from "node:net";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * The screen's response headers made embeddable by the Control Room only
 * (ported from the Food Hub screens gateway, deploy/screens/gateway-lib.mjs):
 * X-Frame-Options removed, frame-ancestors replaced by 'self'.
 */
export function rewriteHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    const key = k.toLowerCase();
    if (key === "x-frame-options" || key === "www-authenticate" || HOP_BY_HOP.has(key)) continue;
    if (key === "content-security-policy") {
      const kept = String(Array.isArray(v) ? v.join(";") : v)
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && !/^frame-ancestors\b/i.test(d));
      if (kept.length) out[key] = kept.join("; ");
      continue;
    }
    out[key] = v;
  }
  out["content-security-policy"] = out["content-security-policy"] ? `${out["content-security-policy"]}; frame-ancestors 'self'` : "frame-ancestors 'self'";
  out["x-content-type-options"] = "nosniff";
  out["referrer-policy"] = "no-referrer";
  return out;
}

export function screenTarget(config, screen) {
  return new URL(config.screenUrlTemplate.replaceAll("{n}", String(screen)));
}

function upstreamHeaders(req, config, target) {
  const headers = {};
  for (const [key, value] of Object.entries(req.headers)) {
    if (!HOP_BY_HOP.has(key) && key !== "cookie" && key !== "authorization") headers[key] = value;
  }
  headers.host = target.host;
  if (config.screenPassword) {
    headers.authorization = `Basic ${Buffer.from(`${config.screenUser}:${config.screenPassword}`).toString("base64")}`;
  }
  return headers;
}

export function proxyHttp(req, res, config, screen) {
  const target = screenTarget(config, screen);
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      method: req.method,
      path: req.url,
      headers: upstreamHeaders(req, config, target),
      timeout: 30_000,
    },
    (upstreamRes) => {
      // www-authenticate is dropped: the browser is never asked for the screen password.
      res.writeHead(upstreamRes.statusCode ?? 502, rewriteHeaders(upstreamRes.headers));
      upstreamRes.pipe(res);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
  upstream.on("error", () => {
    if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
    res.end("Screen unavailable.");
  });
  req.pipe(upstream);
}

/** Forwards an authorized WebSocket upgrade as a raw TCP tunnel. */
export function proxyUpgrade(req, socket, head, config, screen) {
  const target = screenTarget(config, screen);
  const upstream = net.connect(Number(target.port || 80), target.hostname, () => {
    const headers = upstreamHeaders(req, config, target);
    headers.connection = "Upgrade";
    headers.upgrade = req.headers.upgrade ?? "websocket";
    const lines = [`${req.method} ${req.url} HTTP/1.1`];
    for (const [key, value] of Object.entries(headers)) {
      for (const v of Array.isArray(value) ? value : [value]) lines.push(`${key}: ${v}`);
    }
    upstream.write(`${lines.join("\r\n")}\r\n\r\n`);
    if (head?.length) upstream.write(head);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  const close = () => {
    upstream.destroy();
    socket.destroy();
  };
  upstream.on("error", close);
  socket.on("error", close);
  upstream.on("close", () => socket.destroy());
  socket.on("close", () => upstream.destroy());
  return close;
}
