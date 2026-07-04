import cron from "node-cron";
import { getRecentMessages } from "./db.js";
import { generateDigest } from "./llm.js";
import { notify } from "./notify.js";
import { config } from "./config.js";

let waClient = null;

export function initDigest(client) {
  waClient = client;

  const [hour, minute] = config.digestTime.split(":");
  const cronExpr = `${minute} ${hour} * * *`;

  cron.schedule(cronExpr, () => {
    console.log("[Digest] Running daily digest...");
    runDigest();
  });

  console.log(`[Digest] Scheduled daily at ${config.digestTime}`);
}

async function runDigest() {
  const messages = getRecentMessages(24);
  if (messages.length === 0) {
    console.log("[Digest] No messages in last 24h.");
    return;
  }

  const grouped = {};
  for (const m of messages) {
    const name = m.chat_name || m.chat_id;
    if (!grouped[name]) grouped[name] = [];
    grouped[name].push(m);
  }

  console.log(`[Digest] ${messages.length} messages across ${Object.keys(grouped).length} chats`);

  const summary = await generateDigest(grouped);

  try {
    const myNumber = waClient.info.wid._serialized;
    await waClient.sendMessage(myNumber, `📋 *Daily WhatsApp Digest*\n\n${summary}`);
    console.log("[Digest] Sent to self.");
    notify("WhatsApp Digest", "Daily summary sent to your WhatsApp");
  } catch (err) {
    console.error("[Digest] Failed to send:", err.message);
    notify("Digest Error", err.message);
  }
}

export { runDigest };
