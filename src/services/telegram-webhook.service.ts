export type TelegramApi = (method: string, body?: Record<string, unknown>) => Promise<Response>;

export function adminAuthorized(header: string | undefined, token: string | undefined): boolean {
    return Boolean(token && header === `Bearer ${token}`);
}

function sanitize(value: unknown, credentials: string[]): unknown {
    if (typeof value === "string") {
        let text = value;
        for (const credential of credentials) if (credential) text = text.replaceAll(credential, "[redacted]");
        return text.replace(/https?:\/\/[^\s"']+/gi, match => {
            try {
                const parsed = new URL(match);
                parsed.username = "";
                parsed.password = "";
                parsed.search = "";
                parsed.hash = "";
                return parsed.toString();
            } catch { return "[redacted]"; }
        });
    }
    if (Array.isArray(value)) return value.map(item => sanitize(item, credentials));
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret/i.test(key) ? "[redacted]" : sanitize(item, credentials)]));
    return value;
}

export async function manageWebhook(api: TelegramApi, action: "set" | "delete" | "info", url?: string, secret?: string, botToken?: string): Promise<{ status: number; body: unknown }> {
    if (action === "set") {
        if (!url || !secret) return { status: 500, body: { error: "Telegram webhook configuration is incomplete" } };
        try {
            if (new URL(url).protocol !== "https:" || !new URL(url).pathname.endsWith("/telegram/webhook")) return { status: 400, body: { error: "TELEGRAM_WEBHOOK_URL must be HTTPS and end with /telegram/webhook" } };
        } catch {
            return { status: 400, body: { error: "TELEGRAM_WEBHOOK_URL is invalid" } };
        }
    }
    const method = action === "set" ? "setWebhook" : action === "delete" ? "deleteWebhook" : "getWebhookInfo";
    const body = action === "set" ? { url, secret_token: secret, allowed_updates: ["message", "callback_query"] } : undefined;
    try {
        const response = await api(method, body);
        let result: { ok?: boolean; description?: string } & Record<string, unknown>;
        try { result = await response.json() as typeof result; } catch { result = { ok: false, description: "Invalid Telegram response" }; }
        if (!response.ok || !result.ok) return { status: response.status >= 400 ? response.status : 502, body: { error: "Telegram webhook operation failed", telegram: { ok: result.ok ?? false, description: sanitize(result.description, [botToken ?? "", secret ?? ""]) } } };
        return { status: 200, body: sanitize(result, [botToken ?? "", secret ?? ""]) };
    } catch {
        return { status: 502, body: { error: "Telegram webhook operation failed", telegram: { ok: false, description: "Telegram API unavailable" } } };
    }
}
