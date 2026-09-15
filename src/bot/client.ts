import { Bot } from "grammy";
import type { Env } from "../config/env";
import { registerMessageHandler } from "./handlers/message";

export function createBot(env: Env): Bot {
  const bot = new Bot(env.BOT_TOKEN);
  registerMessageHandler(bot, env);
  return bot;
}
