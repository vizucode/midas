import type { TelegramApi } from "../../services/telegram-webhook.service";

export function createTelegramClient(token: string): TelegramApi {
    return (method, data) => fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: data ? JSON.stringify(data) : undefined,
    });
}

export function createTelegramReply(telegram: TelegramApi) {
    return (chatId: string, text: string, approvalId?: string) => telegram("sendMessage", {
        chat_id: chatId,
        text,
        reply_markup: approvalId
            ? {
                inline_keyboard: [[
                    { text: "Setujui", callback_data: `midas:approve:${approvalId}` },
                    { text: "Tolak", callback_data: `midas:reject:${approvalId}` },
                ]],
            }
            : undefined,
    });
}
