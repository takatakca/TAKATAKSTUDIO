// TAKATAK Control Room — local SQLite store (node:sqlite, no dependency).
// Holds the 3 accounts, sessions, screen locks, the journal and notes.
// Passwords are scrypt hashes; session and setup tokens are stored hashed.

import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  username TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  pass_hash TEXT,
  setup_hash TEXT,
  setup_expires INTEGER,
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pending_logins (
  id_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  code_hash TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE TABLE IF NOT EXISTS locks (
  screen INTEGER PRIMARY KEY,
  username TEXT,
  session_hash TEXT,
  acquired_at INTEGER,
  heartbeat_at INTEGER,
  admin_locked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS camera (
  session_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  file TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_chunk_at INTEGER NOT NULL,
  bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  username TEXT,
  screen INTEGER,
  type TEXT NOT NULL,
  detail TEXT
);
CREATE TABLE IF NOT EXISTS notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  username TEXT NOT NULL,
  screen INTEGER,
  text TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS events_at ON events(at);
CREATE INDEX IF NOT EXISTS notes_at ON notes(at);
`;

export function openDb(file) {
  if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;");
  db.exec(SCHEMA);
  return db;
}

/** Runs fn inside one IMMEDIATE transaction (one writer at a time). */
export function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function logEvent(db, { username = null, screen = null, type, detail = null, now = Date.now() }) {
  db.prepare("INSERT INTO events (at, username, screen, type, detail) VALUES (?, ?, ?, ?, ?)").run(
    now,
    username,
    screen,
    type,
    detail === null ? null : String(detail).slice(0, 500),
  );
}
