---
spec: confirmed-financial-changes
title: Confirmed Financial Changes
status: Draft
owner:
date: 2026-10-09
related_adr: []
tags: [spec, retrospective]
version: 1.0.0
---

# SPEC — Confirmed Financial Changes

## Problem
Users need to review and explicitly approve or reject financial changes before configured write tools execute.

## Scope

**In scope**
- Human interruption for `create_records`, `create_account`, `create_budget`, `create_category`, `create_label`, `patch_records`, `patch_accounts`, `patch_budgets`, `patch_categories`, `patch_labels`, and `delete_documents`, if remotely available (`src/core/services/agent.service.ts:26-38,185-187`).
- Approval text for record creation, permanent document deletion, and generic writes (`src/core/usecases/chat.usecase.ts:63-107`).
- Telegram callback resume and thread cleanup (`src/platforms/telegram/bot.ts:16-57`; `src/core/usecases/chat.usecase.ts:32-60`).

**Out of scope**
- Undo/rollback, database transactions, remote authorization, remote idempotency, and roadmap-only write operations.

## Main flow

1. Agent proposes a tool whose name appears in `writeTools`; middleware interrupts before execution (`src/core/services/agent.service.ts:26-38,185-187`).
2. First action request is formatted and returned with thread/interrupt metadata (`src/core/usecases/chat.usecase.ts:110-126`).
3. Bot stores one pending approval per user and renders approve/reject buttons (`src/platforms/telegram/bot.ts:16-29`).
4. Callback removes pending state before resuming the user thread with decision (`src/platforms/telegram/bot.ts:42-56`).
5. Completed resume clears thread; a new interrupt remains pending through reply handling (`src/core/usecases/chat.usecase.ts:49-50`; `src/platforms/telegram/bot.ts:16-29`).

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Only exact names in local `writeTools` trigger approval; remotely available write-like tools absent from this list are not covered by this middleware configuration. | `src/core/services/agent.service.ts:26-38,185-187` |
| 2 | Tool names are locally defined approval policy, not proof those tools are returned remotely. | `src/core/services/agent.service.ts:26-43`; `src/core/services/mcp.service.ts:12-18` |
| 3 | Approval extraction and display use only first interrupt and first action request. | `src/core/usecases/chat.usecase.ts:115-124` |
| 4 | Create-record preview totals absolute numeric amounts and formats IDR; malformed records receive generic confirmation. | `src/core/usecases/chat.usecase.ts:75-107` |
| 5 | Delete preview states permanent deletion when non-empty `ids` are present. No rollback guarantee exists. | `src/core/usecases/chat.usecase.ts:64-73` |
| 6 | Approval state uses user ID only; interrupt ID is passed into display fallback but resume command itself contains only decision and thread ID. | `src/platforms/telegram/bot.ts:25-28,43-55`; `src/core/usecases/chat.usecase.ts:38-49` |
| 7 | Pending callback is deleted before remote resume, preventing retry through same callback after failure. | `src/platforms/telegram/bot.ts:50-55` |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | No pending entry yields “Persetujuan sudah kedaluwarsa” and no resume. |
| Two users acting at the same time | Different user IDs have separate pending entries. Same-user overlapping approvals overwrite map state and share one thread; stale visible buttons may act on newest pending entry because callback data carries no interrupt/message ID. |
| Process fails halfway through | Resume failure is logged, thread cleared, and failure text returned. Source cannot guarantee no write occurred before failure or provide rollback/reconciliation. |
| Quota or limit exceeded | Resume timeout after 120 seconds follows same uncertain failure path; underlying remote work is not explicitly cancelled. |
| Repeated/stale callback | Pending state is consumed before resume; later callback reports expired. A callback from an older approval can consume current same-user pending state. |
| Resume returns error-status tool messages | Unlike initial chat, resume does not scan tool statuses; it extracts output and may clear thread (`src/core/usecases/chat.usecase.ts:49-59,187-205`). Catch text claims transactions have not changed, but that claim is not established by code. |
| Mixed records or invalid dates | Preview labels all records as expenses, uses absolute amounts and first account/date only; invalid dates can throw during formatting. Preview is not financial validation (`src/core/usecases/chat.usecase.ts:84-107`). |
| Restart or multiple interrupted actions | In-memory pending/checkpoint state is lost on restart. Only first action is displayed and one decision sent; multi-action handling is not validated locally (`src/core/usecases/chat.usecase.ts:43,115-124`). |
| Approval message deletion fails | Failure is ignored and resume continues (`src/platforms/telegram/bot.ts:53-55`). |

## System impact

- Models / tables: In-memory LangGraph checkpoint and in-memory pending approval map; no durable local transaction record.
- Services: `src/core/services/agent.service.ts`, `src/core/usecases/chat.usecase.ts`, `src/core/services/mcp.service.ts`.
- Jobs / queues: None.
- Endpoints / routes: Telegram `approval:approve` and `approval:reject` callbacks; outbound MCP tool execution.
- Permissions & roles: Telegram sender ID selects thread/pending state, but no financial-account authorization is enforced locally.

## Definition of done

Retrospective Draft pending review, not release approval. Mock-agent tests verify interruption and approval for configured tools (`tests/core/services/agent.service.test.ts:224-246`); preview tests cover creation and generic text (`tests/core/usecases/chat.usecase.test.ts:4-29`).

- [ ] Main flow works end to end in verified Telegram/MCP execution.
- [x] Every edge case above is handled, or recorded as a deliberate decision.
- [ ] Tests cover callbacks, stale approvals, concurrency, and failure-after-write outcomes.
- [x] This spec matches the current implementation.

## Open questions

- Should callback payload bind user, chat, message, and interrupt IDs to prevent stale approval crossover?
- Should pending approvals and checkpoints survive restarts?
- How should system reconcile timeout/failure when remote write outcome is unknown?
- Should remote tool metadata drive write classification instead of fixed local names?
