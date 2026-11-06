import assert from "node:assert/strict";
import test from "node:test";

import { completeSetup, endSession, finishLogin, getSession, prepareAccount, startLogin, verifyPassword } from "../lib/auth.mjs";
import { loadConfig } from "../lib/config.mjs";
import { setup } from "./helpers.mjs";

const PASSWORD = "a-long-family-password";

function ready(username = "sheroz") {
  const ctx = setup();
  const token = prepareAccount(ctx.db, { username, email: `${username}@example.test`, phone: "+15145550100" });
  assert.equal(completeSetup(ctx.db, { token, password: PASSWORD }).ok, true);
  return ctx;
}

test("only the 3 accounts exist; each person sets a password from a one-time link", () => {
  const ctx = setup();
  assert.throws(() => prepareAccount(ctx.db, { username: "flex", email: "a@b.co", phone: "+15145550100" }), /Unknown account/);
  assert.throws(() => prepareAccount(ctx.db, { username: "sheroz", email: "a@b.co", phone: "5145550100" }), /international/);
  const token = prepareAccount(ctx.db, { username: "Abdullah", email: "a@b.co", phone: "+15145550100" });
  assert.equal(completeSetup(ctx.db, { token, password: "short" }).ok, false, "12 characters minimum");
  assert.equal(completeSetup(ctx.db, { token, password: PASSWORD }).ok, true);
  assert.equal(completeSetup(ctx.db, { token, password: PASSWORD }).ok, false, "the link works once");
  const row = ctx.db.prepare("SELECT pass_hash FROM users WHERE username = 'abdullah'").get();
  assert.ok(row.pass_hash.startsWith("scrypt$") && !row.pass_hash.includes(PASSWORD));
  assert.equal(verifyPassword(PASSWORD, row.pass_hash), true);
  const expired = prepareAccount(ctx.db, { username: "takatak", email: "t@b.co", phone: "+15145550101", now: 0 });
  assert.equal(completeSetup(ctx.db, { token: expired, password: PASSWORD }).ok, false, "links expire after 48 h");
});

test("a login needs the password AND the SMS code; sessions end on logout", async () => {
  const ctx = ready();
  const bad = await startLogin(ctx.db, ctx.sms, { username: "sheroz", password: "wrong-password-123" });
  assert.equal(bad.ok, false);
  assert.equal(ctx.codes.length, 0, "no SMS for a wrong password");
  const unknown = await startLogin(ctx.db, ctx.sms, { username: "nobody", password: PASSWORD });
  assert.equal(unknown.message, bad.message, "same message for unknown accounts");

  const step1 = await startLogin(ctx.db, ctx.sms, { username: "SHEROZ", password: PASSWORD });
  assert.equal(step1.ok, true);
  assert.equal(ctx.codes.length, 1);
  const wrong = await finishLogin(ctx.db, ctx.sms, { pendingId: step1.pendingId, code: "000000" === ctx.codes[0] ? "111111" : "000000", sessionHours: 12 });
  assert.equal(wrong.ok, false);
  const done = await finishLogin(ctx.db, ctx.sms, { pendingId: step1.pendingId, code: ctx.codes[0], sessionHours: 12 });
  assert.equal(done.ok, true);
  assert.equal(getSession(ctx.db, done.sessionId).username, "sheroz");
  const replay = await finishLogin(ctx.db, ctx.sms, { pendingId: step1.pendingId, code: ctx.codes[0], sessionHours: 12 });
  assert.equal(replay.ok, false, "a code works once");
  endSession(ctx.db, done.sessionId);
  assert.equal(getSession(ctx.db, done.sessionId), null);
});

test("5 wrong passwords lock the account 15 minutes; 5 wrong codes end the attempt", async () => {
  const ctx = ready();
  const t0 = 1_000_000;
  for (let i = 0; i < 5; i += 1) await startLogin(ctx.db, ctx.sms, { username: "sheroz", password: "wrong-password-123", now: t0 });
  const locked = await startLogin(ctx.db, ctx.sms, { username: "sheroz", password: PASSWORD, now: t0 + 1000 });
  assert.equal(locked.status, 429);
  const later = await startLogin(ctx.db, ctx.sms, { username: "sheroz", password: PASSWORD, now: t0 + 16 * 60_000 });
  assert.equal(later.ok, true);

  for (let i = 0; i < 5; i += 1) await finishLogin(ctx.db, ctx.sms, { pendingId: later.pendingId, code: "999999", sessionHours: 12, now: t0 + 16 * 60_000 });
  const blocked = await finishLogin(ctx.db, ctx.sms, { pendingId: later.pendingId, code: ctx.codes.at(-1), sessionHours: 12, now: t0 + 16 * 60_000 });
  assert.equal(blocked.ok, false);
  const expired = await startLogin(ctx.db, ctx.sms, { username: "sheroz", password: PASSWORD, now: t0 + 20 * 60_000 });
  const tooLate = await finishLogin(ctx.db, ctx.sms, { pendingId: expired.pendingId, code: ctx.codes.at(-1), sessionHours: 12, now: t0 + 31 * 60_000 });
  assert.equal(tooLate.ok, false, "codes expire after 10 minutes");
});

test("production refuses console SMS and missing settings", () => {
  const { problems } = loadConfig({ NODE_ENV: "production", SMS_MODE: "console" });
  assert.ok(problems.some((p) => /console/.test(p)));
  assert.ok(problems.some((p) => /PUBLIC_ORIGIN/.test(p)));
  assert.ok(problems.some((p) => /SCREEN_PASSWORD/.test(p)));
  const twilio = loadConfig({ NODE_ENV: "production", PUBLIC_ORIGIN: "https://c.example", SCREEN_PASSWORD: "x".repeat(20) });
  assert.ok(twilio.problems.some((p) => /TWILIO/.test(p)));
});
