import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import { dirname } from "path";
import { config } from "./config.js";

mkdirSync(dirname(config.dbPath), { recursive: true });
const db = new Database(config.dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS messages (
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
  CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
  CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id);
`);

const insertStmt = db.prepare(`
  INSERT INTO messages (chat_id, chat_name, sender, sender_name, body, timestamp, is_group)
  VALUES (@chat_id, @chat_name, @sender, @sender_name, @body, @timestamp, @is_group)
`);

const updateActionStmt = db.prepare(`
  UPDATE messages SET processed = 1, action_type = @action_type, action_data = @action_data
  WHERE id = @id
`);

const recentMessagesStmt = db.prepare(`
  SELECT * FROM messages
  WHERE timestamp > @since
  ORDER BY chat_id, timestamp
`);

export function storeMessage(msg) {
  const result = insertStmt.run({
    chat_id: msg.chatId,
    chat_name: msg.chatName,
    sender: msg.sender,
    sender_name: msg.senderName,
    body: msg.body,
    timestamp: msg.timestamp,
    is_group: msg.isGroup ? 1 : 0,
  });
  return result.lastInsertRowid;
}

export function updateAction(id, actionType, actionData) {
  updateActionStmt.run({
    id,
    action_type: actionType,
    action_data: JSON.stringify(actionData),
  });
}

export function getRecentMessages(hoursAgo = 24) {
  const since = Math.floor(Date.now() / 1000) - hoursAgo * 3600;
  return recentMessagesStmt.all({ since });
}

const lastTimestampStmt = db.prepare(`
  SELECT MAX(timestamp) as ts FROM messages
`);

export function getLastTimestamp() {
  const row = lastTimestampStmt.get();
  return row?.ts || 0;
}

export function close() {
  db.close();
}
