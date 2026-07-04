import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
import qrcode from "qrcode-terminal";
import { config } from "./config.js";
import { storeMessage, updateAction, close as closeDb } from "./db.js";
import { parseIntent } from "./llm.js";
import { createEvent, initCalendar } from "./calendar.js";
import { notify } from "./notify.js";
import { initDigest } from "./digest.js";

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
});

client.on("message", async (msg) => {
  if (msg.fromMe) return;

  const chat = await msg.getChat();
  const contact = await msg.getContact();

  const messageData = {
    chatId: chat.id._serialized,
    chatName: chat.name || chat.id.user,
    sender: contact.id._serialized,
    senderName: contact.pushname || contact.name || contact.id.user,
    body: msg.body,
    timestamp: msg.timestamp,
    isGroup: chat.isGroup,
  };

  if (!msg.body || msg.body.trim().length === 0) return;

  const rowId = storeMessage(messageData);
  console.log(`[MSG] ${messageData.chatName} | ${messageData.senderName}: ${msg.body.slice(0, 80)}`);

  const intent = await parseIntent(messageData);

  if (intent.type === "none") return;

  if (intent.confidence < config.confidenceThreshold) {
    console.log(`[Intent] Low confidence (${intent.confidence}): ${intent.type} — skipping`);
    return;
  }

  if (intent.type === "calendar_event" && intent.datetime) {
    const event = await createEvent(intent.title, intent.datetime, intent.duration_minutes);
    if (event) {
      updateAction(rowId, "calendar_event", intent);
      notify("📅 Calendar Event Created", `${intent.title}\n${new Date(intent.datetime).toLocaleString("he-IL")}`);
    }
  }

  if (intent.type === "reminder" && intent.datetime) {
    const delay = new Date(intent.datetime).getTime() - Date.now();
    if (delay > 0) {
      updateAction(rowId, "reminder", intent);
      setTimeout(() => {
        notify("⏰ Reminder", intent.title);
      }, delay);
      notify("Reminder Set", `${intent.title} at ${new Date(intent.datetime).toLocaleString("he-IL")}`);
    }
  }
});

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
