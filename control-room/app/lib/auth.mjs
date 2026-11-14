// TAKATAK Control Room — accounts, login (password + SMS code) and sessions.
// Only the 3 fixed accounts exist. Each person sets their own password from a
// one-time setup link; every login then needs the password AND a fresh SMS code.

import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

import { USERNAMES } from "./config.mjs";
import { logEvent, tx } from "./db.mjs";

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const MAX_FAILED = 5;
const LOCK_MS = 15 * 60_000;
const PENDING_MS = 10 * 60_000;
const SETUP_MS = 48 * 3_600_000;
const MAX_CODE_ATTEMPTS = 5;
export const MIN_PASSWORD = 12;

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function newToken() {
  return randomBytes(32).toString("base64url");
}

export function hashPassword(password) {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  const parts = String(stored ?? "").split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, N, r, p, salt, key] = parts;
  const expected = Buffer.from(key, "base64");
  const actual = scryptSync(password, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p });
  return timingSafeEqual(actual, expected);
}

// A fixed dummy hash keeps the timing of unknown/unset accounts close to real ones.
const DUMMY_HASH = hashPassword(randomBytes(16).toString("hex"));

export function normalizeUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  return USERNAMES.includes(username) ? username : null;
}

export function validPhone(value) {
  return /^\+[1-9]\d{7,14}$/.test(String(value ?? ""));
}

export function validEmail(value) {
  return /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(String(value ?? ""));
}

/** Owner bootstrap (bin/admin.mjs): sets email + phone and returns a one-time setup token. */
export function prepareAccount(db, { username, email, phone, now = Date.now() }) {
  const name = normalizeUsername(username);
  if (!name) throw new Error(`Unknown account. Allowed: ${USERNAMES.join(", ")}`);
  if (!validEmail(email)) throw new Error("Invalid email.");
  if (!validPhone(phone)) throw new Error("Phone must be in international format, for example +15145551234.");
  const token = newToken();
  tx(db, () => {
    db.prepare(
      `INSERT INTO users (username, email, phone, setup_hash, setup_expires, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(username) DO UPDATE SET email = excluded.email, phone = excluded.phone,
         setup_hash = excluded.setup_hash, setup_expires = excluded.setup_expires, failed = 0, locked_until = 0`,
    ).run(name, email.trim(), phone, hashToken(token), now + SETUP_MS, now);
    db.prepare("DELETE FROM sessions WHERE username = ?").run(name);
    logEvent(db, { username: name, type: "account.prepared", now });
  });
  return token;
}

export function completeSetup(db, { token, password, now = Date.now() }) {
  if (typeof password !== "string" || password.length < MIN_PASSWORD || password.length > 200) {
    return { ok: false, message: `The password needs at least ${MIN_PASSWORD} characters.` };
  }
  const user = db.prepare("SELECT username, setup_expires FROM users WHERE setup_hash = ?").get(hashToken(String(token ?? "")));
  if (!user || user.setup_expires < now) return { ok: false, message: "This link is invalid or expired. Ask for a new one." };
  tx(db, () => {
    db.prepare("UPDATE users SET pass_hash = ?, setup_hash = NULL, setup_expires = NULL, failed = 0, locked_until = 0 WHERE username = ?").run(
      hashPassword(password),
      user.username,
    );
    db.prepare("DELETE FROM sessions WHERE username = ?").run(user.username);
    logEvent(db, { username: user.username, type: "account.password_set", now });
  });
  return { ok: true, username: user.username };
}

const GENERIC_LOGIN_ERROR = "Wrong account or password.";

/** Step 1: password. On success an SMS code is sent and a pending login returned. */
export async function startLogin(db, sms, { username, password, ip, now = Date.now() }) {
  const name = normalizeUsername(username);
  const user = name ? db.prepare("SELECT * FROM users WHERE username = ?").get(name) : null;
  const passwordOk = verifyPassword(String(password ?? ""), user?.pass_hash ?? DUMMY_HASH) && Boolean(user?.pass_hash);

  if (!user) return { ok: false, status: 401, message: GENERIC_LOGIN_ERROR };
  if (user.locked_until > now) {
    logEvent(db, { username: name, type: "login.blocked_locked", detail: ip, now });
    return { ok: false, status: 429, message: "Too many attempts. Try again in 15 minutes." };
  }
  if (!passwordOk) {
    const failed = user.failed + 1;
    db.prepare("UPDATE users SET failed = ?, locked_until = ? WHERE username = ?").run(
      failed >= MAX_FAILED ? 0 : failed,
      failed >= MAX_FAILED ? now + LOCK_MS : 0,
      name,
    );
    logEvent(db, { username: name, type: failed >= MAX_FAILED ? "login.locked" : "login.bad_password", detail: ip, now });
    return { ok: false, status: 401, message: GENERIC_LOGIN_ERROR };
  }

  const { codeHash } = await sms.send(user.phone, name);
  const pendingId = newToken();
  tx(db, () => {
    db.prepare("DELETE FROM pending_logins WHERE username = ? OR expires_at < ?").run(name, now);
    db.prepare("INSERT INTO pending_logins (id_hash, username, code_hash, expires_at) VALUES (?, ?, ?, ?)").run(
      hashToken(pendingId),
      name,
      codeHash,
      now + PENDING_MS,
    );
    db.prepare("UPDATE users SET failed = 0 WHERE username = ?").run(name);
    logEvent(db, { username: name, type: "login.code_sent", detail: ip, now });
  });
  return { ok: true, pendingId, phone: user.phone };
}

/** Step 2: SMS code. On success a session is created. */
export async function finishLogin(db, sms, { pendingId, code, ip, userAgent, sessionHours, now = Date.now() }) {
  const pending = db.prepare("SELECT * FROM pending_logins WHERE id_hash = ?").get(hashToken(String(pendingId ?? "")));
  if (!pending || pending.expires_at < now) return { ok: false, status: 401, message: "The code expired. Log in again." };
  if (pending.attempts >= MAX_CODE_ATTEMPTS) {
    db.prepare("DELETE FROM pending_logins WHERE id_hash = ?").run(pending.id_hash);
    return { ok: false, status: 429, message: "Too many wrong codes. Log in again." };
  }
  const user = db.prepare("SELECT phone FROM users WHERE username = ?").get(pending.username);
  const valid = user ? await sms.check(user.phone, String(code ?? "").trim(), pending.code_hash) : false;
  if (!valid) {
    db.prepare("UPDATE pending_logins SET attempts = attempts + 1 WHERE id_hash = ?").run(pending.id_hash);
    logEvent(db, { username: pending.username, type: "login.bad_code", detail: ip, now });
    return { ok: false, status: 401, message: "Wrong code." };
  }
  const sessionId = newToken();
  tx(db, () => {
    db.prepare("DELETE FROM pending_logins WHERE id_hash = ?").run(pending.id_hash);
    db.prepare("INSERT INTO sessions (id_hash, username, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)").run(
      hashToken(sessionId),
      pending.username,
      now,
      now + sessionHours * 3_600_000,
      ip ?? null,
      String(userAgent ?? "").slice(0, 300),
    );
    logEvent(db, { username: pending.username, type: "login.success", detail: ip, now });
  });
  return { ok: true, sessionId, username: pending.username };
}

export function getSession(db, sessionId, now = Date.now()) {
  if (!sessionId) return null;
  const idHash = hashToken(sessionId);
  const session = db.prepare("SELECT id_hash, username, expires_at FROM sessions WHERE id_hash = ?").get(idHash);
  if (!session || session.expires_at < now) return null;
  return { idHash, username: session.username };
}

export function endSession(db, sessionId, now = Date.now()) {
  if (!sessionId) return;
  const idHash = hashToken(sessionId);
  const session = db.prepare("SELECT username FROM sessions WHERE id_hash = ?").get(idHash);
  if (!session) return;
  tx(db, () => {
    db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(idHash);
    db.prepare("UPDATE locks SET username = NULL, session_hash = NULL, acquired_at = NULL, heartbeat_at = NULL WHERE session_hash = ?").run(idHash);
    logEvent(db, { username: session.username, type: "logout", now });
  });
}
