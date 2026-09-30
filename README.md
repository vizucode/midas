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
- Telegram bot token, if running Telegram adapter

## Setup

Install dependencies:

```bash
bun install
```

Create `.env` in project root:

```env
BOT_TOKEN=your_telegram_bot_token
```

Bun loads `.env` automatically.

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
