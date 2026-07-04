import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { resolve } from "path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq);
    const val = trimmed.slice(eq + 1);
    if (!process.env[key]) process.env[key] = val;
  }
}

export const config = {
  digestTime: process.env.DIGEST_TIME || "21:00",
  confidenceThreshold: parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.7"),
  dbPath: process.env.DB_PATH || "./data/messages.db",

  googleClientId: process.env.GOOGLE_CLIENT_ID,
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET,
  googleCalendarId: process.env.GOOGLE_CALENDAR_ID || "primary",

  gcpProject: process.env.GOOGLE_CLOUD_PROJECT || (() => {
    try { return execSync("gcloud config get-value project", { encoding: "utf-8" }).trim(); }
    catch { return undefined; }
  })(),
  gcpRegion: process.env.GOOGLE_CLOUD_REGION || "us-east5",
};
