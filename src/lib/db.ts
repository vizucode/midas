import { createClient } from "@libsql/client";
import type { Env } from "../config/env";

export type ConversationState = {
  chatId: string;
  lastIntent: string | null;
  lastParams: string | null;
  lastTool: string | null;
  lastToolResult: string | null;
  updatedAt: string;
};

export type IntentRecord = {
  chatId: string;
  intent: string;
  params: string;
  prompt: string;
};

let dbInstance: ReturnType<typeof createClient> | null = null;

function getDb(env: Env) {
  if (!dbInstance) {
    dbInstance = createClient({ url: env.TURSO_HOST, authToken: env.TURSO_TOKEN });
  }
  return dbInstance;
}

export async function initDb(env: Env): Promise<void> {
  const db = getDb(env);
  await db.batch([
    `CREATE TABLE IF NOT EXISTS conversation_state (chat_id TEXT PRIMARY KEY, last_intent TEXT, last_params TEXT, last_tool TEXT, last_tool_result TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    `CREATE TABLE IF NOT EXISTS intent_log (id INTEGER PRIMARY KEY AUTOINCREMENT, chat_id TEXT NOT NULL, intent TEXT NOT NULL, params_json TEXT NOT NULL, raw_prompt TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  ], "write");
}

export async function getConversationState(env: Env, chatId: string): Promise<ConversationState | null> {
  const db = getDb(env);
  const result = await db.execute({
    sql: "SELECT chat_id, last_intent, last_params, last_tool, last_tool_result, updated_at FROM conversation_state WHERE chat_id = ? LIMIT 1",
    args: [chatId],
  });
  const row = result.rows[0];
  return row ? {
    chatId: String(row.chat_id),
    lastIntent: row.last_intent ? String(row.last_intent) : null,
    lastParams: row.last_params ? String(row.last_params) : null,
    lastTool: row.last_tool ? String(row.last_tool) : null,
    lastToolResult: row.last_tool_result ? String(row.last_tool_result) : null,
    updatedAt: String(row.updated_at),
  } : null;
}

export async function saveConversationState(env: Env, input: {
  chatId: string;
  lastIntent?: string | null;
  lastParams?: string | null;
  lastTool?: string | null;
  lastToolResult?: string | null;
}): Promise<void> {
  const db = getDb(env);
  await db.execute({
    sql: `INSERT INTO conversation_state (chat_id, last_intent, last_params, last_tool, last_tool_result, updated_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP) ON CONFLICT(chat_id) DO UPDATE SET last_intent = excluded.last_intent, last_params = excluded.last_params, last_tool = excluded.last_tool, last_tool_result = excluded.last_tool_result, updated_at = CURRENT_TIMESTAMP`,
    args: [input.chatId, input.lastIntent ?? null, input.lastParams ?? null, input.lastTool ?? null, input.lastToolResult ?? null],
  });
}

export async function saveIntent(env: Env, input: IntentRecord): Promise<void> {
  const db = getDb(env);
  await db.execute({
    sql: "INSERT INTO intent_log (chat_id, intent, params_json, raw_prompt) VALUES (?, ?, ?, ?)",
    args: [input.chatId, input.intent, input.params, input.prompt],
  });
}
