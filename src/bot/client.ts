import { Bot } from "grammy";
import { env } from "../config/env";
import { registerMessageHandler } from "./handlers/message";

export const bot = new Bot(env.BOT_TOKEN);

registerMessageHandler(bot);
