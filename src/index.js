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

client.on("message_create", async (msg) => {
  try {
    const chat = await msg.getChat();

    let senderName = "Me";
    let senderId = msg.from;
    if (!msg.fromMe) {
      try {
        const contact = await msg.getContact();
        senderId = contact.id._serialized;
        senderName = contact.pushname || contact.name || contact.id.user;
      } catch { /* device WID lookup can fail for own messages */ }
    }

    const messageData = {
      chatId: chat.id._serialized,
      chatName: chat.name || chat.id.user,
      sender: senderId,
      senderName,
      body: msg.body,
      timestamp: msg.timestamp,
      isGroup: chat.isGroup,
    };

  if (!msg.body || msg.body.trim().length === 0) return;
  if (msg.fromMe && (msg.body.startsWith("📅") || msg.body.startsWith("⏰") || msg.body.startsWith("📋"))) return;

  const rowId = storeMessage(messageData);
  const direction = msg.fromMe ? "→" : "←";
  console.log(`[MSG] ${direction} ${messageData.chatName} | ${messageData.senderName}: ${msg.body.slice(0, 80)}`);

  const intent = await parseIntent(messageData);
  console.log(`[Intent] ${JSON.stringify(intent)}`);

  if (intent.type === "none") return;

  if (intent.confidence < config.confidenceThreshold) {
    console.log(`[Intent] Low confidence (${intent.confidence}): ${intent.type} — skipping`);
    return;
  }

  if (intent.type === "calendar_event" && intent.datetime) {
    const event = await createEvent(intent.title, intent.datetime, intent.duration_minutes);
    if (event) {
      updateAction(rowId, "calendar_event", intent);
      const timeStr = new Date(intent.datetime).toLocaleString("he-IL");
      notify("📅 Calendar Event Created", `${intent.title}\n${timeStr}`);
      await msg.reply(`📅 נוסף ליומן: ${intent.title}\n🕐 ${timeStr}`);
      console.log(`[Reply] Calendar confirmation sent`);
    }
  }

  if (intent.type === "reminder" && intent.datetime) {
    const delay = new Date(intent.datetime).getTime() - Date.now();
    if (delay > 0) {
      updateAction(rowId, "reminder", intent);
      const timeStr = new Date(intent.datetime).toLocaleString("he-IL");
      setTimeout(() => {
        notify("⏰ Reminder", intent.title);
      }, delay);
      notify("Reminder Set", `${intent.title} at ${timeStr}`);
      await msg.reply(`⏰ תזכורת נקבעה: ${intent.title}\n🕐 ${timeStr}`);
      console.log(`[Reply] Reminder confirmation sent`);
    }
  }
  } catch (err) {
    console.error("[Handler] Error processing message:", err.message);
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
