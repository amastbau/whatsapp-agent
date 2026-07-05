import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";
import { initCalendar } from "./calendar.js";
import { notify } from "./notify.js";
import { initDigest } from "./digest.js";
import { getLastTimestamp, getDueReminders, markReminderFired, close as closeDb } from "./db.js";
import { handleMessage } from "./handler.js";

const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: { headless: true, args: ["--no-sandbox"] },
});

client.on("qr", (qr) => {
  console.log("[WA] Scan QR code:");
  qrcode.generate(qr, { small: true });
});

client.on("ready", async () => {
  console.log("[WA] Connected as", client.info.pushname);
  notify("WhatsApp Agent", "Connected and listening");

  const calendarReady = await initCalendar();
  if (calendarReady) console.log("[Calendar] Ready");

  initDigest(client);
  startReminderChecker();

  await processMissedMessages();
});

async function processMissedMessages() {
  const lastTs = getLastTimestamp();
  if (!lastTs) {
    console.log("[Startup] No message history — skipping missed message scan");
    return;
  }

  console.log("[Startup] Scanning for missed messages...");
  let processed = 0;

  try {
    const chats = await client.getChats();
    for (const chat of chats) {
      const messages = await chat.fetchMessages({ limit: 50 });
      for (const msg of messages) {
        if (msg.timestamp <= lastTs) continue;
        if (!msg.body || msg.body.trim().length === 0) continue;

        await handleMessage(msg, client);
        processed++;
      }
    }
  } catch (err) {
    console.error("[Startup] Error scanning missed messages:", err.message);
  }

  console.log(`[Startup] Processed ${processed} missed messages`);
}

function startReminderChecker() {
  setInterval(async () => {
    const due = getDueReminders();
    for (const r of due) {
      try {
        await client.sendMessage(r.chat_id, `⏰ תזכורת: ${r.title}`);
        markReminderFired(r.id);
        notify("⏰ Reminder", r.title);
        console.log(`[Reminder] Fired: ${r.title}`);
      } catch (err) {
        console.error(`[Reminder] Failed to send: ${err.message}`);
      }
    }
  }, 60_000);
  console.log("[Reminders] Checker started (every 60s)");
}

client.on("message_create", (msg) => handleMessage(msg, client));

client.on("disconnected", (reason) => {
  console.warn("[WA] Disconnected:", reason);
  notify("WhatsApp Agent", `Disconnected: ${reason}`);
});

client.on("auth_failure", (msg) => {
  console.error("[WA] Auth failed:", msg);
  notify("WhatsApp Agent Error", "Authentication failed");
});

process.on("SIGINT", () => {
  console.log("\nShutting down...");
  closeDb();
  client.destroy();
  process.exit(0);
});

console.log("[WA] Starting WhatsApp Agent...");
client.initialize();
