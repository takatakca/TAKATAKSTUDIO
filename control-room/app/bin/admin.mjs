#!/usr/bin/env node
// TAKATAK Control Room — owner commands, run inside the app container
// (Coolify › control-room › Terminal). Nothing here is ever committed.
//
//   node bin/admin.mjs prepare <takatak|sheroz|abdullah> <email> <+phone>
//       Sets the account's email and phone and prints a one-time link
//       (valid 48 h) where that person chooses their own password.
//   node bin/admin.mjs status
//       Shows the 3 accounts (masked) and the screens.
//   node bin/admin.mjs logout-all
//       Ends every session and frees every screen.

import { join } from "node:path";

import { prepareAccount } from "../lib/auth.mjs";
import { loadConfig, USERNAMES } from "../lib/config.mjs";
import { logEvent, openDb } from "../lib/db.mjs";
import { maskPhone } from "../lib/sms.mjs";

const { config } = loadConfig();
const db = openDb(join(config.dataDir, "control-room.sqlite3"));
const [command, ...args] = process.argv.slice(2);

function maskEmail(email) {
  const [user, domain] = String(email ?? "").split("@");
  return user && domain ? `${user.slice(0, 2)}•••@${domain}` : "—";
}

if (command === "prepare") {
  const [username, email, phone] = args;
  try {
    const token = prepareAccount(db, { username, email, phone });
    const origin = config.publicOrigin || `http://localhost:${config.port}`;
    console.log(`Account ${username.toLowerCase()} ready. Send this link to that person only (valid 48 h, one use):`);
    console.log(`${origin}/setup?token=${token}`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
} else if (command === "status") {
  for (const username of USERNAMES) {
    const user = db.prepare("SELECT email, phone, pass_hash, locked_until FROM users WHERE username = ?").get(username);
    const stateText = !user ? "not prepared" : !user.pass_hash ? "waiting for password" : user.locked_until > Date.now() ? "locked 15 min" : "active";
    console.log(`${username.padEnd(9)} ${stateText.padEnd(22)} ${maskEmail(user?.email)} ${user ? maskPhone(user.phone) : ""}`);
  }
  for (const lock of db.prepare("SELECT screen, username, admin_locked FROM locks ORDER BY screen").all()) {
    console.log(`screen ${lock.screen}: ${lock.admin_locked ? "blocked" : lock.username ?? "free"}`);
  }
} else if (command === "logout-all") {
  db.exec("DELETE FROM sessions; DELETE FROM pending_logins; UPDATE locks SET username = NULL, session_hash = NULL, acquired_at = NULL, heartbeat_at = NULL;");
  logEvent(db, { username: "admin-cli", type: "admin.logout_all" });
  console.log("All sessions ended; markers are removed on the next sweep (15 s).");
} else {
  console.log("Usage: node bin/admin.mjs prepare <takatak|sheroz|abdullah> <email> <+phone> | status | logout-all");
  process.exit(command ? 1 : 0);
}
