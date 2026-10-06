import { Telegraf, type Context } from "telegraf";
import { handleMessage } from "../../handlers/message.handler";
import { resumeChat } from "../../core/usecases/chat.usecase";
import type { FinancialAgent } from "../../core/services/agent.service";

export function startTelegramBot(agent: FinancialAgent) {
    const bot = new Telegraf(process.env.BOT_TOKEN!);
    const pendingApprovals = new Map<string, { interruptId: string; messageId: number }>();

    const reply = async (ctx: Context, userId: string | number, response: Awaited<ReturnType<typeof handleMessage>>) => {
        if (typeof response === "string") {
            await ctx.reply(response);
            return;
        }

        if (response.approval) {
            const message = await ctx.reply(response.text, {
                reply_markup: {
                    inline_keyboard: [[
                        { text: "Setujui", callback_data: "approval:approve" },
                        { text: "Tolak", callback_data: "approval:reject" },
                    ]],
                },
            });
            pendingApprovals.set(userId.toString(), {
                interruptId: response.approval.interruptId,
                messageId: message.message_id,
            });
            return;
        }

        await ctx.reply(response.text || "Maaf, belum ada respons. Coba lagi.");
    };

    bot.on("message", async (ctx) => {
        if (!("text" in ctx.message)) return;

        const response = await handleMessage(agent, ctx.from.id, ctx.message.text);
        await reply(ctx, ctx.from.id, response);
    });

    bot.action(/^approval:(approve|reject)$/, async (ctx) => {
        const userId = ctx.from.id.toString();
        const pending = pendingApprovals.get(userId);
        if (!pending) {
            await ctx.answerCbQuery("Persetujuan sudah kedaluwarsa.");
            return;
        }

        const decision = ctx.match[1] as "approve" | "reject";
        pendingApprovals.delete(userId);
        await ctx.answerCbQuery(decision === "approve" ? "Disetujui" : "Ditolak");
        await ctx.telegram.deleteMessage(ctx.chat!.id, pending.messageId).catch(() => undefined);

        const response = await resumeChat(agent, userId, pending.interruptId, decision);
        await reply(ctx, userId, response);
    });

    bot.launch();

    process.once('SIGINT', () => bot.stop('SIGINT'))
    process.once('SIGTERM', () => bot.stop('SIGTERM'))

    return bot;
}