import { describe, expect, mock, test } from "bun:test";
import { adminAuthorized, manageWebhook } from "../../src/services/telegram-webhook.service";

describe("Telegram webhook management", () => {
    test("requires exact bearer token", () => {
        expect(adminAuthorized(undefined, "secret")).toBe(false);
        expect(adminAuthorized("Bearer wrong", "secret")).toBe(false);
        expect(adminAuthorized("Bearer secret", "secret")).toBe(true);
        expect(adminAuthorized("Bearer secret", undefined)).toBe(false);
    });

    test("sets configured HTTPS webhook", async () => {
        const api = mock(async () => Response.json({ ok: true, result: true }));
        const result = await manageWebhook(api, "set", "https://api.example.com/telegram/webhook", "secret");
        expect(result.status).toBe(200);
        expect(api).toHaveBeenCalledWith("setWebhook", {
            url: "https://api.example.com/telegram/webhook",
            secret_token: "secret",
            allowed_updates: ["message", "callback_query"],
        });
    });

    test("rejects unsafe webhook URL", async () => {
        const api = mock(async () => Response.json({ ok: true }));
        expect((await manageWebhook(api, "set", "http://api.example.com/telegram/webhook", "secret")).status).toBe(400);
        expect((await manageWebhook(api, "set", "https://api.example.com/wrong", "secret")).status).toBe(400);
        expect(api).not.toHaveBeenCalled();
    });

    test("deletes and reads webhook", async () => {
        const api = mock(async (method: string, _body?: Record<string, unknown>) => Response.json({ ok: true, result: method }));
        await manageWebhook(api, "delete");
        await manageWebhook(api, "info");
        expect(api.mock.calls).toEqual([["deleteWebhook"], ["getWebhookInfo"]]);
    });

    test("redacts credentials from successful info", async () => {
        const result = await manageWebhook(async () => Response.json({ ok: true, result: { url: "https://example.com/telegram/webhook?secret=leak", secret_token: "secret" } }), "info", "https://example.com/telegram/webhook", "secret");
        expect(JSON.stringify(result)).not.toContain("\"secret\"");
        expect(JSON.stringify(result)).not.toContain("?secret=leak");
    });

    test("sanitizes Telegram errors", async () => {
        const result = await manageWebhook(async () => Response.json({ ok: false, description: "Bad Request" }, { status: 400 }), "info");
        expect(result).toEqual({ status: 400, body: { error: "Telegram webhook operation failed", telegram: { ok: false, description: "Bad Request" } } });
    });
});
