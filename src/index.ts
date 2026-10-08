import { Hono } from "hono";
import { mkdir } from "node:fs/promises";
import { Mastra } from "@mastra/core";
import { LibSQLStore } from "@mastra/libsql";
import { ApprovalStore } from "./core/services/approval.store";
import { getMcpTools, closeMcp } from "./core/services/mcp.service";
import { createFinancialAgent, reads, writes } from "./core/services/agent.service";
import { ChatService } from "./core/usecases/chat.usecase";
import { NineRouterGateway } from "./mastra/gateway";

const env = (key: string) => process.env[key];
const token = env("TELEGRAM_BOT_TOKEN"), secret = env("TELEGRAM_WEBHOOK_SECRET_TOKEN");
const allowed = new Set((env("TELEGRAM_ALLOWED_USER_IDS") ?? "").split(",").map(x => x.trim()).filter(Boolean));
if (!token || !secret || !allowed.size) throw new Error("TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET_TOKEN, and TELEGRAM_ALLOWED_USER_IDS are required");
const url = env("DATABASE_URL") ?? "file:./data/midas.db", auth = env("DATABASE_AUTH_TOKEN");
if (url.startsWith("file:./data/")) await mkdir("data", { recursive: true });
const store = new ApprovalStore(url, auth, Number(env("APPROVAL_EXPIRY_MS") ?? 86400000), Number(env("APPROVAL_RETENTION_MS") ?? 2592000000));
await store.init();
const tools = await getMcpTools();
const agent = await createFinancialAgent(store, tools);
const contracts = Object.fromEntries(Object.entries(tools).filter(([key]) => reads.has(key.replace(/^budgetBakers_/, "")) || writes.has(key.replace(/^budgetBakers_/, ""))).map(([key, tool]) => [key, JSON.stringify(tool.inputSchema?.["~standard"].jsonSchema.input({ target: "draft-07" }) ?? {})]));
const chat = new ChatService(agent, store, contracts);
const storage = new LibSQLStore({ id: "midas-storage", url, authToken: auth });
await storage.init();
const mastra = new Mastra({ agents: { financialAgent: agent }, gateways: { nineRouter: new NineRouterGateway() }, storage });
const app = new Hono();
const telegram = (method: string, data: Record<string, unknown>) => fetch(`https://api.telegram.org/bot${token}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
const reply = (id: string, text: string, approval?: string) => telegram("sendMessage", { chat_id: id, text, reply_markup: approval ? { inline_keyboard: [[{ text: "Setujui", callback_data: `midas:approve:${approval}` }, { text: "Tolak", callback_data: `midas:reject:${approval}` }]] } : undefined });

app.post("/telegram/webhook", async c => {
    if (c.req.header("x-telegram-bot-api-secret-token") !== secret) return c.json({ error: "unauthorized" }, 401);
    const update = await c.req.json<any>();
    if (!(await store.delivery(String(update.update_id)))) return c.json({ ok: true });
    const event = update.message ?? update.callback_query?.message;
    const sender = update.message?.from ?? update.callback_query?.from;
    if (!event?.chat || event.chat.type !== "private" || !sender || !allowed.has(String(sender.id))) return c.json({ ok: true });
    const targetChat = String(event.chat.id), owner = String(sender.id);
    if (update.callback_query) {
        const [prefix, action, id] = String(update.callback_query.data ?? "").split(":");
        if (prefix !== "midas" || !id || !["approve", "reject"].includes(action ?? "")) return c.json({ ok: true });
        const result = await chat.decide(owner, targetChat, id, action === "approve");
        await telegram("answerCallbackQuery", { callback_query_id: update.callback_query.id, text: action === "approve" ? "Diproses" : "Ditolak" });
        await reply(targetChat, result.text, result.approval?.id);
        return c.json({ ok: true });
    }
    if (typeof update.message?.text !== "string") return c.json({ ok: true });
    const result = await chat.message(owner, targetChat, update.message.text);
    await reply(targetChat, result.text, result.approval?.id);
    return c.json({ ok: true });
});

const listener = Bun.serve({ port: Number(env("PORT") ?? 4111), fetch: app.fetch });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, async () => { await mastra.shutdown(); await closeMcp(); store.close(); listener.stop(); process.exit(0); });
