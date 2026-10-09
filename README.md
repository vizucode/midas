# Midas

**Your personal finance assistant and accounting partner.**

Midas is not a generic chatbot. It is built to help people understand, organize, and act on their financial information through natural conversation. Connect it to Telegram today; extend it to Discord, web, or other platforms tomorrow.

Bring your own AI model: cloud LLM, local LLM, or any compatible provider.

## What Midas is for

- Record and classify income, expenses, assets, and liabilities
- Ask questions about cash flow, spending, budgets, and financial position
- Turn conversational input into useful accounting actions
- Support personal finance guidance and bookkeeping workflows
- Keep core finance logic independent from chat platform and LLM provider

## Architecture

```text
platforms (Telegram, Discord, Web)
              |
           handlers
              |
        core use cases
              |
  AI services / accounting logic
```

Platform adapters receive messages. Handlers normalize requests. Core logic owns reusable finance and AI workflows. This separation lets Midas grow without duplicating business logic for every platform.

```text
src/
├── core/
│   ├── services/          # LLM, accounting, database services
│   └── usecases/          # reusable finance workflows
├── handlers/              # platform-neutral request handlers
├── platforms/
│   ├── telegram/          # Telegram adapter
│   ├── discord/           # Discord adapter
│   └── web/               # Web/API adapter
├── config/                # configuration helpers
├── utils/                 # shared utilities, including JSON logs
└── index.ts               # application entry point
```

## Requirements

- [Bun](https://bun.sh/)
- Telegram bot token, webhook secret, and allowed private-chat sender IDs
- Persistent libSQL database URL

## Setup

Install dependencies:

```bash
bun install
```

Create `.env` in project root:

```env
TELEGRAM_BOT_TOKEN=replace_me
TELEGRAM_WEBHOOK_SECRET_TOKEN=replace_me
TELEGRAM_WEBHOOK_URL=https://your-host.example/telegram/webhook
TELEGRAM_ADMIN_TOKEN=replace_me
TELEGRAM_ALLOWED_USER_IDS=123456789
NINE_ROUTER_MODEL=replace_me
NINE_ROUTER_API_KEY=replace_me
NINE_ROUTER_BASE_URL=https://router.example/v1
MCP_SERVER_URL=https://wallet.example/mcp
MCP_SERVER_AUTH_TOKEN=replace_me
DATABASE_URL=file:./data/midas.db
DATABASE_AUTH_TOKEN=
APPROVAL_EXPIRY_MS=86400000
APPROVAL_RETENTION_MS=2592000000
PORT=4111
```

Set `TELEGRAM_ALLOWED_USER_IDS` to comma-separated user IDs, or `*` to accept every private-chat sender. Group chats are always ignored. Wildcard access lets anyone messaging the bot read financial data and approve their own writes using the shared MCP credentials. Approval ownership checks remain enforced. Midas stores the last 20 messages per Telegram sender and private chat in the configured libSQL database; messages begin accumulating after deployment and are isolated between users/chats. Approval expires after 24 hours; completed metadata is retained for 30 days by default. Local file storage requires persistent disk and one application instance.

Bun loads `.env` automatically. Set `TELEGRAM_WEBHOOK_URL` to your public HTTPS URL including `/telegram/webhook`. This variable is used for registration only; the app does not register automatically. Start the app and expose its port before registering:

```bash
bun -e '
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET_TOKEN;
const url = process.env.TELEGRAM_WEBHOOK_URL;
if (!token || !secret || !url) throw new Error("Missing Telegram registration environment variables");
if (new URL(url).protocol !== "https:") throw new Error("TELEGRAM_WEBHOOK_URL must use HTTPS");
const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ url, secret_token: secret, allowed_updates: ["message", "callback_query"] })
});
const result = await response.json();
if (!response.ok || !result.ok) throw new Error("Telegram webhook registration failed");
console.log("Telegram webhook registered");
'
```

## Telegram webhook management

Set `TELEGRAM_ADMIN_TOKEN` to a long random value. Management routes require `Authorization: Bearer <TELEGRAM_ADMIN_TOKEN>`.

| Operation | Method | Route |
|---|---|---|
| Set configured webhook | `POST` | `/admin/telegram/webhook` |
| Get webhook info | `GET` | `/admin/telegram/webhook` |
| Delete webhook | `DELETE` | `/admin/telegram/webhook` |

All routes use configured Telegram credentials. Set uses `TELEGRAM_WEBHOOK_URL`, webhook secret, and only `message`/`callback_query` updates. No route accepts arbitrary URLs or returns tokens/secrets.

```bash
export ADMIN_AUTH="Authorization: Bearer $TELEGRAM_ADMIN_TOKEN"
curl -sS -X POST -H "$ADMIN_AUTH" https://your-host.example/admin/telegram/webhook
curl -sS -H "$ADMIN_AUTH" https://your-host.example/admin/telegram/webhook
curl -sS -X DELETE -H "$ADMIN_AUTH" https://your-host.example/admin/telegram/webhook
```

Run set after Midas is publicly reachable. Run info to verify delivery configuration. Delete stops Telegram deliveries but does not stop Midas or delete local state.

## Run

Development mode watches source changes and restarts app:

```bash
bun dev
```

Run once:

```bash
bun start
```

## Structured logs

Midas writes one JSON object per line to stdout. This makes logs easy to filter locally and ingest into observability tools.

```json
{"level":"info","time":"2026-09-30T12:34:56.789Z","msg":"message received","userId":123,"message":"hello"}
```

Pipe logs through `jq` for readable output:

```bash
bun dev | jq
```

## AI model freedom

Midas does not lock you into one model or provider. Add an AI service in `src/core/services/` and call it from a use case in `src/core/usecases/`.

Possible backends:

- Hosted models from your preferred cloud provider
- Self-hosted models through Ollama, vLLM, or similar runtimes
- OpenAI-compatible APIs
- Rules or deterministic accounting logic where AI is unnecessary

Keep provider-specific code inside services. Keep finance behavior inside core use cases.

## Roadmap

- Transaction capture and categorization
- Ledger and chart-of-accounts support
- Budgeting and cash-flow summaries
- Receipt and document ingestion
- Multi-currency support
- Human review and audit trails
- More platform adapters

## Security

Never commit `.env` or API keys. Financial data needs careful access control, validation, and auditability before production use.
