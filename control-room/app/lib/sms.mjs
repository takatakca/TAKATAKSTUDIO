// TAKATAK Control Room — SMS login codes.
// twilio: Twilio Verify sends and checks the code (no code stored here).
// console: development only; the code is printed to the server log and its
//          hash kept on the pending login. Refused in production (config.mjs).

import { createHash, randomInt, timingSafeEqual } from "node:crypto";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function createSms(config, { fetchImpl = fetch, log = console.log } = {}) {
  if (config.smsMode === "console") {
    return {
      mode: "console",
      async send(phone, username) {
        const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
        log(`[sms:console] login code for ${username} (${maskPhone(phone)}): ${code}`);
        return { codeHash: sha256(code) };
      },
      async check(_phone, code, codeHash) {
        if (!codeHash || !/^\d{6}$/.test(code)) return false;
        const a = Buffer.from(sha256(code));
        const b = Buffer.from(codeHash);
        return a.length === b.length && timingSafeEqual(a, b);
      },
    };
  }

  const { accountSid, authToken, verifyServiceSid } = config.twilio;
  const base = `https://verify.twilio.com/v2/Services/${encodeURIComponent(verifyServiceSid)}`;
  const headers = {
    Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };

  return {
    mode: "twilio",
    async send(phone) {
      const response = await fetchImpl(`${base}/Verifications`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ To: phone, Channel: "sms" }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) throw new Error(`twilio_send_${response.status}`);
      return { codeHash: null };
    },
    async check(phone, code) {
      if (!/^\d{4,10}$/.test(code)) return false;
      const response = await fetchImpl(`${base}/VerificationCheck`, {
        method: "POST",
        headers,
        body: new URLSearchParams({ To: phone, Code: code }),
        signal: AbortSignal.timeout(10_000),
      });
      if (response.status === 404) return false; // expired or already used
      if (!response.ok) throw new Error(`twilio_check_${response.status}`);
      const body = await response.json();
      return body.status === "approved";
    },
  };
}

export function maskPhone(phone) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? `•••${digits.slice(-4)}` : "•••";
}
