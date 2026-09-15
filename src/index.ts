import { webhookCallback } from "grammy";
import { createBot } from "./bot/client";
import { parseEnv } from "./config/env";
import { initDb } from "./lib/db";

export default {
  async fetch(request: Request, rawEnv: Record<string, string | undefined>): Promise<Response> {
    const env = parseEnv(rawEnv);
    await initDb(env);

    const bot = createBot(env);
    bot.catch(({ error }) => console.error("Telegram bot error:", error));
    return webhookCallback(bot, "cloudflare-mod")(request);
  },
};
