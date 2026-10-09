import { Hono, type Context } from "hono";
import type { ApprovalStore } from "../core/services/approval.store";
import type { ChatService } from "../core/usecases/chat.usecase";
import { createTelegramReply } from "../platforms/telegram/client";
import { adminAuthorized, manageWebhook, type TelegramApi } from "../services/telegram-webhook.service";

export function createTelegramRoutes(options: {
    store: ApprovalStore;
    chat: ChatService;
    telegram: TelegramApi;
    token: string;
    secret: string;
    allowed: Set<string>;
    allowAllUsers: boolean;
    adminToken?: string;
    webhookUrl?: string;
}) {
    const app = new Hono();
    const reply = createTelegramReply(options.telegram);

    async function webhookManagement(context: Context, action: "set" | "delete" | "info") {
        const authorized = adminAuthorized(context.req.header("authorization"), options.adminToken);

        if (!authorized) {
            return context.json({ error: "unauthorized" }, 401);
        }

        const result = await manageWebhook(
            options.telegram,
            action,
            options.webhookUrl,
            options.secret,
            options.token,
        );

        return context.json(result.body, result.status as 200 | 400 | 401 | 500 | 502);
    }

    app.post("/admin/telegram/webhook", context => {
        return webhookManagement(context, "set");
    });
    app.delete("/admin/telegram/webhook", context => {
        return webhookManagement(context, "delete");
    });
    app.get("/admin/telegram/webhook", context => {
        return webhookManagement(context, "info");
    });

    app.post("/telegram/webhook", async context => {
        const headerSecret = context.req.header("x-telegram-bot-api-secret-token");

        if (headerSecret !== options.secret) {
            return context.json({ error: "unauthorized" }, 401);
        }

        const update = await context.req.json<any>();
        const delivered = await options.store.delivery(String(update.update_id));

        if (!delivered) {
            return context.json({ ok: true });
        }

        const event = update.message ?? update.callback_query?.message;
        const sender = update.message?.from ?? update.callback_query?.from;
        const isPrivateChat = event?.chat?.type === "private";
        const isAllowedSender = sender && (options.allowAllUsers || options.allowed.has(String(sender.id)));

        if (!event?.chat || !isPrivateChat || !isAllowedSender) {
            return context.json({ ok: true });
        }

        const chatId = String(event.chat.id);
        const ownerId = String(sender.id);

        if (update.callback_query) {
            const [prefix, action, approvalId] = String(update.callback_query.data ?? "").split(":");
            const validAction = action === "approve" || action === "reject";

            if (prefix !== "midas" || !approvalId || !validAction) {
                return context.json({ ok: true });
            }

            const result = await options.chat.decide(ownerId, chatId, approvalId, action === "approve");
            const confirmation = action === "approve" ? "Diproses" : "Ditolak";

            await options.telegram("answerCallbackQuery", {
                callback_query_id: update.callback_query.id,
                text: confirmation,
            });
            await reply(chatId, result.text, result.approval?.id);

            return context.json({ ok: true });
        }

        if (typeof update.message?.text !== "string") {
            return context.json({ ok: true });
        }

        const result = await options.chat.message(ownerId, chatId, update.message.text);
        await reply(chatId, result.text, result.approval?.id);

        return context.json({ ok: true });
    });

    return app;
}
