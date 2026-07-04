import { execFile } from "child_process";

export function notify(title, body) {
  execFile("notify-send", [
    "--app-name=WhatsApp Agent",
    "--urgency=normal",
    title,
    body,
  ], (err) => {
    if (err) console.error("[Notify] Failed:", err.message);
  });
}
