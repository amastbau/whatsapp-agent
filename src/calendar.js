import { google } from "googleapis";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { createServer } from "http";
import { URL } from "url";
import { config } from "./config.js";

const TOKEN_PATH = "./google-token.json";
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"];

let auth = null;

function getOAuth2Client() {
  return new google.auth.OAuth2(
    config.googleClientId,
    config.googleClientSecret,
    "http://localhost:3000/oauth2callback"
  );
}

async function authorize() {
  const oauth2 = getOAuth2Client();

  if (existsSync(TOKEN_PATH)) {
    const tokens = JSON.parse(readFileSync(TOKEN_PATH, "utf-8"));
    oauth2.setCredentials(tokens);
    oauth2.on("tokens", (newTokens) => {
      const merged = { ...tokens, ...newTokens };
      writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
    });
    auth = oauth2;
    return;
  }

  const authUrl = oauth2.generateAuthUrl({ access_type: "offline", scope: SCOPES });
  console.log("[Calendar] Authorize by visiting:", authUrl);

  const code = await new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, "http://localhost:3000");
      const code = url.searchParams.get("code");
      if (code) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authorized! You can close this tab.</h1>");
        server.close();
        resolve(code);
      }
    });
    server.listen(3000);
  });

  const { tokens } = await oauth2.getToken(code);
  oauth2.setCredentials(tokens);
  writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  auth = oauth2;
  console.log("[Calendar] Authorization complete.");
}

export async function initCalendar() {
  if (!config.googleClientId || !config.googleClientSecret) {
    console.warn("[Calendar] No Google credentials configured — calendar disabled.");
    return false;
  }
  await authorize();
  return true;
}

export async function createEvent(title, startTime, durationMinutes = 60) {
  if (!auth) {
    console.error("[Calendar] Not authorized.");
    return null;
  }

  const calendar = google.calendar({ version: "v3", auth });
  const start = new Date(startTime);
  const end = new Date(start.getTime() + durationMinutes * 60000);

  const event = {
    summary: title,
    start: { dateTime: start.toISOString(), timeZone: "Asia/Jerusalem" },
    end: { dateTime: end.toISOString(), timeZone: "Asia/Jerusalem" },
  };

  try {
    const res = await calendar.events.insert({
      calendarId: config.googleCalendarId,
      resource: event,
    });
    console.log(`[Calendar] Created: "${title}" at ${start.toLocaleString()}`);
    return res.data;
  } catch (err) {
    console.error("[Calendar] Create failed:", err.message);
    return null;
  }
}

export async function getEvents(daysAhead = 1) {
  if (!auth) return null;

  const calendar = google.calendar({ version: "v3", auth });
  const now = new Date();
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  if (daysAhead > 0) start.setDate(start.getDate() + (daysAhead === 1 ? 1 : 0));
  const end = new Date(start);
  end.setDate(end.getDate() + (daysAhead === 0 ? 1 : daysAhead));

  try {
    const res = await calendar.events.list({
      calendarId: config.googleCalendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
    });

    const events = res.data.items || [];
    if (events.length === 0) return "אין פגישות.";

    return events.map((e) => {
      const t = new Date(e.start.dateTime || e.start.date);
      const time = e.start.dateTime
        ? t.toLocaleTimeString("he-IL", { hour: "2-digit", minute: "2-digit" })
        : "כל היום";
      return `• ${time} — ${e.summary}`;
    }).join("\n");
  } catch (err) {
    console.error("[Calendar] Query failed:", err.message);
    return "שגיאה בקריאת היומן.";
  }
}
