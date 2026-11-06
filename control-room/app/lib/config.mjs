// TAKATAK Control Room — configuration from the environment.
// Secrets (Twilio, screen password) only come from the environment, never
// from source. See ../.env.example for every variable.

export const USERNAMES = ["sheroz", "abdullah", "takatak"];

function int(value, fallback) {
  const n = Number.parseInt(value ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env = process.env) {
  const production = env.NODE_ENV === "production";
  const smsMode = (env.SMS_MODE ?? "twilio").trim();
  const config = {
    production,
    port: int(env.PORT, 8080),
    dataDir: env.DATA_DIR ?? "./data",
    recordingsDir: env.RECORDINGS_DIR ?? "./recordings",
    screenCount: Math.min(int(env.SCREEN_COUNT, 6), 12),
    screenUrlTemplate: env.SCREEN_URL_TEMPLATE ?? "http://screen-{n}:3000",
    screenUser: env.SCREEN_USER ?? "abc",
    screenPassword: env.SCREEN_PASSWORD ?? "",
    supervisors: (env.SUPERVISORS ?? "takatak").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    cameraRequired: env.CAMERA_REQUIRED !== "false",
    cookieSecure: env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : production,
    publicOrigin: (env.PUBLIC_ORIGIN ?? "").replace(/\/$/, ""),
    sessionHours: int(env.SESSION_HOURS, 12),
    lockTimeoutSeconds: int(env.LOCK_TIMEOUT_SECONDS, 90),
    cameraTimeoutSeconds: int(env.CAMERA_TIMEOUT_SECONDS, 45),
    smsMode,
    twilio: {
      accountSid: env.TWILIO_ACCOUNT_SID ?? "",
      authToken: env.TWILIO_AUTH_TOKEN ?? "",
      verifyServiceSid: env.TWILIO_VERIFY_SERVICE_SID ?? "",
    },
  };
  const problems = [];
  if (smsMode !== "twilio" && smsMode !== "console") problems.push("SMS_MODE must be twilio or console.");
  if (production && smsMode === "console") problems.push("SMS_MODE=console is refused in production: every login needs a real SMS code.");
  if (smsMode === "twilio" && (!config.twilio.accountSid || !config.twilio.authToken || !config.twilio.verifyServiceSid)) {
    problems.push("TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_VERIFY_SERVICE_SID are required.");
  }
  if (production && !config.publicOrigin) problems.push("PUBLIC_ORIGIN is required in production (for example https://control.example.com).");
  if (production && config.screenPassword.length < 16) problems.push("SCREEN_PASSWORD must be at least 16 characters in production.");
  return { config, problems };
}
