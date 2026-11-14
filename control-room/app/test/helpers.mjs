import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "../lib/config.mjs";
import { openDb } from "../lib/db.mjs";
import { createSms } from "../lib/sms.mjs";

export function setup(env = {}) {
  const dir = mkdtempSync(join(tmpdir(), "control-room-"));
  const { config } = loadConfig({
    SMS_MODE: "console",
    DATA_DIR: join(dir, "data"),
    RECORDINGS_DIR: join(dir, "recordings"),
    SCREEN_PASSWORD: "screen-password-for-tests",
    ...env,
  });
  const db = openDb(":memory:");
  const codes = [];
  const sms = createSms(config, { log: (line) => codes.push(line.match(/(\d{6})$/)?.[1]) });
  return { dir, config, db, sms, codes };
}
