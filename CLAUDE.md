# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

WhatsApp automation agent: monitors all incoming WhatsApp messages, parses intent via Claude (Vertex AI), and takes actions — creating Google Calendar events, setting reminders, running system commands, and delivering a nightly digest summary back via WhatsApp.

Single-process Node.js monolith. No build step, no tests, no linter.

## Running

```bash
npm start          # node src/index.js — starts everything
```

First run requires QR code scan in terminal (WhatsApp Web auth). Session persists in `.wwebjs_auth/` after that.

Google Calendar requires OAuth consent on first run (opens browser, callback on `localhost:3000`). Token saved to `google-token.json`.

## Environment

Copy `.env.example` to `.env`. Required for calendar:
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — from GCP console
- `GOOGLE_CLOUD_PROJECT` — for Vertex AI (Claude API); auto-detected from `gcloud` if unset

Key settings in `.env` (defaults in `config.js`):
- `DIGEST_TIME` (default `21:00`) — when daily digest fires
- `CONFIDENCE_THRESHOLD` (default `0.7`) — minimum LLM confidence to act
- `BLOCKED_CHATS` — comma-separated chat name substrings to ignore

## Architecture

```
index.js  →  WhatsApp client init, QR auth, missed-message scan on startup,
             reminder checker (60s interval), wires message_create to handler

handler.js → Central message router. Stores every message to DB, then:
             1. Manual digest trigger (fromMe + "digest"/"סיכום")
             2. parseIntent() via LLM
             3. Routes by intent type: calendar_event, reminder, calendar_query, command
             Stale messages (>60s) and non-self commands are rejected.

llm.js    →  Claude via AnthropicVertex SDK. Two functions:
             - parseIntent(): structured JSON extraction from single message
             - generateDigest(): summarize 24h of grouped messages
             Model: claude-opus-4-6. Intent prompt includes available system commands.

db.js     →  SQLite (better-sqlite3, WAL mode). Two tables:
             - messages: all captured messages with optional action_type/action_data
             - reminders: title, due_at, chat_id, fired flag

calendar.js → Google Calendar OAuth2 + event CRUD. Timezone: Asia/Jerusalem.
digest.js   → Cron-scheduled (node-cron). Groups recent messages by chat → LLM summary → sends to self.
commands.js → Executes shell commands via execFile (no shell, no sudo). 30s timeout.
notify.js   → Linux desktop notifications via notify-send.
config.js   → Reads .env manually (no dotenv), exports config object with env var overrides.
```

## Key Design Decisions

- **Every message hits the LLM** — even low-confidence results get stored for digest
- **Bot's own messages are filtered** by emoji prefix (`📅⏰📋🖥️`) to avoid feedback loops
- **Commands only run from self-messages** and only if <60s old (staleness guard)
- **Calendar queries only respond to self-messages** (not other people's messages)
- **Reminders are persistent** (SQLite) and checked every 60s; sent back to originating chat
- **Hebrew-first UI** — reply messages, calendar output, error strings are in Hebrew
- **No dotenv package** — `config.js` parses `.env` manually
- **LLM auth is GCP Vertex AI** — uses `gcloud` ADC, not Anthropic API key
