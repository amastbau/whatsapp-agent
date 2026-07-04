# WhatsApp Agent — Design Spec

## Overview

A Node.js service that monitors all incoming WhatsApp messages via `whatsapp-web.js`, parses intent using Claude Opus 4.8, and takes automated actions: creating Google Calendar events, sending desktop notifications, and delivering a daily message digest back via WhatsApp.

## Architecture

Single-process monolith. One `npm start` runs everything.

```
┌─────────────────────────────────────────────────┐
│              WhatsApp Agent (Node.js)            │
│                                                  │
│  ┌──────────┐                  ┌─────────────┐  │
│  │ WhatsApp  │─── every msg ──▶│ Claude API  │  │
│  │ Listener  │                 │ (Opus 4.8)  │  │
│  └─────┬────┘                  └──────┬──────┘  │
│        │                              │         │
│   ┌────▼─────┐                 ┌──────▼──────┐  │
│   │ Message  │                 │   Actions   │  │
│   │ Store    │                 │ ┌─────────┐ │  │
│   │ (SQLite) │                 │ │ GCal    │ │  │
│   └────┬─────┘                 │ │ Notify  │ │  │
│        │                       │ │ WA Msg  │ │  │
│   ┌────▼─────┐                 │ └─────────┘ │  │
│   │ Digest   │────────────────▶│             │  │
│   │ (cron)   │                 └─────────────┘  │
│   └──────────┘                                   │
└─────────────────────────────────────────────────┘
```

## Message Flow — Real-Time

1. **Capture** — sender name, phone, message text, timestamp, chat name, is_group flag
2. **Store** — write to SQLite `messages` table
3. **Send to Claude Opus 4.8** — every message, with structured output prompt:

```
Analyze this WhatsApp message (may be Hebrew, English, or mixed).
Return JSON:
{
  "type": "calendar_event" | "reminder" | "none",
  "title": "string (in the message's language)",
  "datetime": "ISO 8601",
  "duration_minutes": number (default 60),
  "confidence": 0.0-1.0
}
If not actionable, return: {"type": "none"}
```

4. **If confidence > 0.7 and type = "calendar_event"** → create Google Calendar event + desktop notification confirming
5. **If confidence > 0.7 and type = "reminder"** → schedule desktop notification at specified time
6. **If confidence ≤ 0.7 or type = "none"** → no action, message stored for digest

## Daily Digest Flow

Triggered by `node-cron` at a configurable time (default: 21:00).

1. Query SQLite for all messages from last 24 hours, grouped by chat
2. Send to Claude Opus 4.8 with digest prompt:

```
Summarize these WhatsApp messages from the last 24 hours.
Messages may be in Hebrew, English, or mixed.

Group by conversation. For each:
- Key topics discussed
- Action items / decisions made
- Anything requiring my attention

Keep it concise. Use the same language as the original messages.
```

3. Send summary as WhatsApp message to the user's own chat (message-to-self)

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | Node.js 22 | Already installed on system |
| WhatsApp | `whatsapp-web.js` | Most mature WhatsApp automation library |
| LLM | Claude Opus 4.8 via Anthropic SDK | GCP-authed, work-funded, best quality |
| Calendar | Google Calendar API (`googleapis`) | User's calendar system |
| Database | SQLite via `better-sqlite3` | Zero setup, single-file, fast |
| Notifications | `notify-send` via `child_process` | Native Linux desktop notifications |
| Scheduler | `node-cron` | Lightweight, in-process cron |
| Session persistence | `.wwebjs_auth/` local dir | Survives restarts after initial QR scan |

## Data Model

### SQLite Schema

```sql
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  chat_name TEXT,
  sender TEXT,
  sender_name TEXT,
  body TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  is_group INTEGER DEFAULT 0,
  processed INTEGER DEFAULT 0,
  action_type TEXT,
  action_data TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_messages_timestamp ON messages(timestamp);
CREATE INDEX idx_messages_chat ON messages(chat_id);
```

## Project Structure

```
whatsapp-agent/
├── src/
│   ├── index.js          # Entry point — WhatsApp client init + message listener
│   ├── llm.js            # Claude API client via Anthropic SDK (GCP Vertex auth)
│   ├── calendar.js       # Google Calendar event creation
│   ├── db.js             # SQLite setup + message CRUD
│   ├── digest.js         # Daily digest: query + LLM summarize + send via WA
│   ├── notify.js         # Desktop notifications via notify-send
│   └── config.js         # Configurable settings (digest time, confidence threshold)
├── package.json
└── .env                  # Google Calendar OAuth credentials (not committed)
```

## Configuration

Via `config.js` with env var overrides:

| Setting | Default | Env Var |
|---------|---------|---------|
| Digest time | `21:00` | `DIGEST_TIME` |
| Confidence threshold | `0.7` | `CONFIDENCE_THRESHOLD` |
| SQLite path | `./data/messages.db` | `DB_PATH` |
| Google Calendar ID | `primary` | `GOOGLE_CALENDAR_ID` |

## Authentication

- **Claude API**: Anthropic SDK with GCP auth (Vertex AI). Uses existing `gcloud` credentials.
- **Google Calendar**: OAuth2 via `googleapis`. First run opens browser for consent. Tokens stored in `.env` / token file.
- **WhatsApp**: QR code scan on first run. Session persisted in `.wwebjs_auth/`.

## Error Handling

- **LLM failures**: Log error, skip action, message still stored for digest
- **Calendar failures**: Desktop notification with error, log, continue
- **WhatsApp disconnects**: `whatsapp-web.js` auto-reconnects. Log disconnect/reconnect events.
- **Invalid LLM response**: JSON parse failure → treat as `type: "none"`, log warning

## Security

- No secrets sent to LLM — only message text
- `.env` and `.wwebjs_auth/` in `.gitignore`
- SQLite file stored locally, not exposed
- Google OAuth tokens stored locally

## Future Considerations (not in v1)

- Todo list integration
- Auto-reply capability
- Web dashboard for summaries
- Multiple WhatsApp account support
