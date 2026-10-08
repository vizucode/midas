---
spec: telegram-finance-chat
title: Telegram Finance Chat
status: Draft
owner:
date: 2026-10-09
related_adr: []
tags: [spec, retrospective]
version: 1.0.0
---

# SPEC — Telegram Finance Chat

## Problem
Users need a Telegram entry point for finance questions and changes, with responses suitable for chat and explicit approval before configured writes.

## Scope

**In scope**
- Telegram text messages routed by user ID to the finance chat use case (`src/platforms/telegram/bot.ts:35-40`).
- Indonesian plain-text responses, Markdown cleanup, and generic error replies (`src/handlers/message.handler.ts:5-29`).
- Inline approval and rejection flow for interrupted write tool calls (`src/platforms/telegram/bot.ts:16-57`).

**Out of scope**
- Telegram non-text messages, commands, authentication policy, and roadmap features not present in source.

## Main flow

1. Bot receives text and calls `handleMessage` with `ctx.from.id` (`src/platforms/telegram/bot.ts:35-40`).
2. Handler calls `chatUsecase`; successful output is normalized for Telegram (`src/handlers/message.handler.ts:5-16`).
3. An approval response gets inline Setujui/Tolak buttons and is stored in an in-memory map keyed by user ID (`src/platforms/telegram/bot.ts:16-29`).
4. Callback uses stored interrupt ID to resume the agent, deletes the approval message when possible, then replies with the result (`src/platforms/telegram/bot.ts:42-56`).

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Only text messages enter the message flow. | `src/platforms/telegram/bot.ts:35-38` |
| 2 | Responses are returned as Indonesian plain text; handler removes common Markdown formatting. | Prompt instruction `src/core/usecases/chat.usecase.ts:156-165`; cleanup `src/handlers/message.handler.ts:9-16` |
| 3 | Write requests exposed to the agent interrupt for human approval. | `src/core/services/agent.service.ts:26-38,185-187` |
| 4 | Approval state is keyed by Telegram user ID and holds one pending callback state per user. | `src/platforms/telegram/bot.ts:8,25-28,44-55` |
| 5 | Missing pending state is reported as expired; no resume occurs. | `src/platforms/telegram/bot.ts:44-48` |
| 6 | Approval callback identity uses `ctx.from.id`; source does not enforce that callback message/chat belongs to original requester beyond that lookup. | `src/platforms/telegram/bot.ts:42-55` |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | Agent/MCP decides response; bot substitutes “Maaf, belum ada respons. Coba lagi.” for empty output (`src/platforms/telegram/bot.ts:32`). |
| Two users acting at the same time | Map entries are separated by user ID; concurrent requests for one user share/overwrite one pending slot. No locking exists. |
| Process fails halfway through | Callback resume catches failure, clears thread, and returns failure text. Source does not prove failed resume caused no remote write. |
| Quota or limit exceeded | Handler has a specific legacy error-string branch; current agent middleware throws a different budget error, so generic failure may be returned (`src/handlers/message.handler.ts:25-29`; `src/core/services/agent.service.ts:130-142`). |

## System impact

- Models / tables: None in this repository; LangGraph `MemorySaver` holds in-process thread state (`src/core/services/agent.service.ts:9,44-45`).
- Services: `src/core/usecases/chat.usecase.ts`, `src/core/services/agent.service.ts`, `src/core/services/mcp.service.ts`.
- Jobs / queues: None.
- Endpoints / routes: Telegram Telegraf message and callback handlers (`src/platforms/telegram/bot.ts:35-57`).
- Permissions & roles: No per-user authorization or role enforcement is implemented; MCP bearer token is process-wide (`src/core/services/mcp.service.ts:5-18`).

## Definition of done

Retrospective Draft pending review, not release approval. Repository tests do not exercise real Telegram callback identity or end-to-end MCP behavior.

- [ ] Main flow works end to end in a verified Telegram/MCP environment.
- [x] Every edge case above is handled, or recorded as a deliberate decision.
- [ ] Tests cover critical Telegram callback, identity, and same-user concurrency rules.
- [x] This spec matches the current implementation.

## Open questions

- Should callback identity validate original chat/message ownership?
- What should happen when one user starts another request while approval is pending?
- Can MCP write idempotency or transaction status expose whether failure happened before or after a remote write?
