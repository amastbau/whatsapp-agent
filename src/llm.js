import { AnthropicVertex } from "@anthropic-ai/vertex-sdk";
import { config } from "./config.js";

const client = new AnthropicVertex({
  projectId: config.gcpProject,
  region: config.gcpRegion,
});

const MODEL = "claude-opus-4-6";

const INTENT_PROMPT = `Analyze this WhatsApp message (may be Hebrew, English, or mixed).
Return ONLY valid JSON, no markdown:

For calendar events or reminders:
{
  "type": "calendar_event" | "reminder",
  "title": "string (in the message's language)",
  "datetime": "ISO 8601 string",
  "duration_minutes": number (default 60),
  "confidence": 0.0-1.0
}

For calendar queries (asking about upcoming events/meetings):
{
  "type": "calendar_query",
  "days_ahead": number (0=today, 1=tomorrow, 7=this week),
  "confidence": 0.0-1.0
}

For system commands (user asking to run something on their computer):
{
  "type": "command",
  "command": "full path to command",
  "description": "what this does",
  "confidence": 0.0-1.0
}

Available scripts on the computer:
- /home/amastbau/helperes/display-34-only.sh — Keep only 34" ultrawide, disable internal + 27"
- /home/amastbau/helperes/display-34-plus-27-portrait.sh — 34" ultrawide + 27" portrait
- /home/amastbau/helperes/display-all.sh — Enable all 3 displays (internal + 27" + 34")

Common commands the user might ask for:
- Lock screen: "loginctl lock-session"
- Screenshot: "gnome-screenshot -f /tmp/screenshot.png"
- Volume mute: "pactl set-sink-mute @DEFAULT_SINK@ toggle"
- Volume up/down: "pactl set-sink-volume @DEFAULT_SINK@ +10%" or "-10%"

If not actionable, return: {"type": "none"}

Context:
- Sender: {sender}
- Chat: {chat}
- Time sent: {time}
- From me: {fromMe}

Message:
{body}`;

export async function parseIntent(msg) {
  const now = new Date().toISOString();
  const prompt = INTENT_PROMPT
    .replace("{sender}", msg.senderName || msg.sender || "Unknown")
    .replace("{chat}", msg.chatName || "Direct")
    .replace("{time}", new Date(msg.timestamp * 1000).toISOString())
    .replace("{fromMe}", msg.fromMe ? "yes" : "no")
    .replace("{body}", msg.body);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });

    let text = response.content.find((b) => b.type === "text")?.text;
    if (!text) return { type: "none" };

    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) text = jsonMatch[1].trim();

    return JSON.parse(text);
  } catch (err) {
    console.error("[LLM] Intent parse failed:", err.message);
    return { type: "none" };
  }
}

export async function generateDigest(messagesByChat) {
  let prompt = `Summarize these WhatsApp messages from the last 24 hours.
Messages may be in Hebrew, English, or mixed.

Group by conversation. For each:
- Key topics discussed
- Action items / decisions made
- Anything requiring my attention

Keep it concise. Use the same language as the original messages.

---

`;

  for (const [chatName, messages] of Object.entries(messagesByChat)) {
    prompt += `## ${chatName}\n\n`;
    for (const m of messages) {
      const time = new Date(m.timestamp * 1000).toLocaleTimeString("he-IL");
      prompt += `[${time}] ${m.sender_name || m.sender}: ${m.body}\n`;
    }
    prompt += "\n";
  }

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    return response.content.find((b) => b.type === "text")?.text || "No summary generated.";
  } catch (err) {
    console.error("[LLM] Digest generation failed:", err.message);
    return "Failed to generate daily digest.";
  }
}
