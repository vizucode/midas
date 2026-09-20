import { createBot } from "./bot/client";
import { parseEnv } from "./config/env";
import { initDb } from "./lib/db";
import { getAgentTools } from "./lib/langchain";

const env = parseEnv(Bun.env);
const bot = createBot(env);

bot.catch(({ error }) => console.error("Telegram bot error:", error));

await initDb(env);

try {
  const tools = await getAgentTools(env);
  console.log(`BudgetBakers MCP connected (${tools.length} tools)`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`BudgetBakers MCP disconnected: ${message}`);
}

await bot.start({
  onStart: ({ username }) => console.log(`Bot @${username} berjalan`),
});
