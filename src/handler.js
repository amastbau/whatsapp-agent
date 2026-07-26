import { config } from "./config.js";
import { storeMessage, updateAction, addReminder } from "./db.js";
import { parseIntent } from "./llm.js";
import { createEvent, getEvents } from "./calendar.js";
import { notify } from "./notify.js";
import { runDigest } from "./digest.js";
import { runCommand } from "./commands.js";

const BOT_PREFIXES = ["📅", "⏰", "📋", "🖥️"];

async function sendToMe(client, text) {
  const me = client.info.wid._serialized;
  await client.sendMessage(me, text);
}

function extractChatName(msg) {
  // msg._data has notifyName (sender's push name) and chat name info
  const data = msg._data || {};
  if (data.notifyName) return data.notifyName;
  // Fall back to parsing the chat ID
  const chatId = msg.from || "";
  return chatId.replace(/@.*/, "");
}

export async function handleMessage(msg, client) {
  try {
    if (!msg.body || msg.body.trim().length === 0) return;
    if (msg.fromMe && BOT_PREFIXES.some((p) => msg.body.startsWith(p))) return;

    const chatId = msg.fromMe ? msg.to : msg.from;
    const isGroup = chatId.endsWith("@g.us");
    const senderName = msg.fromMe ? "Me" : (msg._data?.notifyName || msg.author || chatId.replace(/@.*/, ""));
    const chatName = extractChatName(msg);

    if (config.blockedChats.some((b) => chatName?.includes(b))) return;

    const messageData = {
      chatId,
      chatName,
      sender: msg.fromMe ? client.info.wid._serialized : (msg.author || msg.from),
      senderName,
      body: msg.body,
      timestamp: msg.timestamp,
      isGroup,
      fromMe: msg.fromMe,
    };

    const rowId = storeMessage(messageData);
    const direction = msg.fromMe ? "→" : "←";
    console.log(`[MSG] ${direction} ${chatName} | ${senderName}: ${msg.body.slice(0, 80)}`);

    if (msg.fromMe && /^(digest|סיכום|סכם|summary)/i.test(msg.body.trim())) {
      console.log("[Digest] Manual digest triggered");
      await sendToMe(client, "📋 מכין סיכום יומי...");
      await runDigest();
      return;
    }

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
        const src = msg.fromMe ? "" : `\n💬 ${chatName}`;
        await sendToMe(client, `📅 נוסף ליומן: ${intent.title}\n🕐 ${timeStr}${src}`);
        console.log(`[Reply] Calendar confirmation sent`);
      }
    }

    if (intent.type === "reminder" && intent.datetime) {
      const dueAt = new Date(intent.datetime).getTime();
      if (dueAt > Date.now()) {
        updateAction(rowId, "reminder", intent);
        addReminder(intent.title, dueAt, chatId);
        const timeStr = new Date(intent.datetime).toLocaleString("he-IL");
        notify("Reminder Set", `${intent.title} at ${timeStr}`);
        const src = msg.fromMe ? "" : `\n💬 ${chatName}`;
        await sendToMe(client, `⏰ תזכורת נקבעה: ${intent.title}\n🕐 ${timeStr}${src}`);
        console.log(`[Reply] Reminder stored for ${timeStr}`);
      }
    }

    const msgAge = Date.now() - msg.timestamp * 1000;
    const isStale = msgAge > 60_000;

    if (intent.type === "calendar_query") {
      if (isStale) return;
      if (!msg.fromMe) return;
      const days = intent.days_ahead ?? 1;
      const label = days === 0 ? "היום" : days === 1 ? "מחר" : `${days} ימים קרובים`;
      const events = await getEvents(days);
      await sendToMe(client, `📅 פגישות ${label}:\n\n${events}`);
      console.log(`[Calendar] Query: ${days} days ahead`);
    }

    if (intent.type === "command" && intent.command) {
      if (isStale) {
        console.log(`[Command] Skipped stale command (${Math.round(msgAge / 1000)}s old)`);
        return;
      }
      if (!msg.fromMe) {
        console.log(`[Command] Rejected: command from non-self message`);
        return;
      }
      console.log(`[Command] Running: ${intent.command}`);
      const result = await runCommand(intent.command);
      const status = result.success ? "✅" : "❌";
      await sendToMe(client, `🖥️ ${intent.description || intent.command}\n${status} ${result.output.slice(0, 500)}`);
      console.log(`[Command] ${status} ${result.output.slice(0, 100)}`);
    }
  } catch (err) {
    console.error("[Handler] Error processing message:", err.message, err.stack);
  }
}
