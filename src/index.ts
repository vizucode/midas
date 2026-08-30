import { bot } from "./bot/client";
import { listMcpTools } from "./lib/mcp";

bot.catch(({ error }) => {
  console.error("Telegram bot error:", error);
});

try {
  const tools = await listMcpTools(true);
  console.log(`BudgetBakers MCP connected (${tools.length} tools)`);
} catch (error) {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`BudgetBakers MCP disconnected: ${message}`);
}

await bot.start({
  onStart: ({ username }) => console.log(`Bot @${username} berjalan`),
});
