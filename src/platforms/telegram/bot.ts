import { Telegraf } from "telegraf";
import { handleMessage } from "../../handlers/message.handler";
import type { FinancialAgent } from "../../core/services/agent.service";

export function startTelegramBot(agent: FinancialAgent) {
    const bot = new Telegraf(process.env.BOT_TOKEN!);

    bot.on("message", async (ctx) => {
        if (!("text" in ctx.message)) return;

        const response = await handleMessage(agent, ctx.from.id, ctx.message.text);
        await ctx.reply(response);
    });

    bot.launch();

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))

    return bot;
}