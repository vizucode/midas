---
spec: telegram-memory-and-guardrails
title: Telegram Memory and Mastra Guardrails
status: Shipped
owner:
date: 2026-10-09
related_adr: []
tags: [spec, memory, guardrails, telegram]
version: 1.0.1
---

# SPEC — Telegram Memory and Mastra Guardrails

## Problem

Midas forgets user-provided context between Telegram messages, and model input/output lacks Mastra's built-in normalization, injection detection, and prompt-disclosure controls.

## Scope

**In scope**
- Persist Mastra message history in existing libSQL storage.
- Isolate memory by Telegram sender and private chat.
- Apply Unicode normalization and deterministic prompt-injection/system-prompt filters to the financial agent. Keep the no-tool conversational agent available without model-backed guardrail calls.
- Preserve deterministic finance routing and approval controls.

**Out of scope**
- Semantic recall, observational memory, shared group-chat memory, memory administration endpoints, or migration of earlier messages.

## Main flow

1. Telegram identity supplies stable memory resource and thread IDs.
2. Model-backed request loads recent history, processes normalized input, and rejects detected injection.
3. Response is scrubbed for internal prompt disclosure and persisted with user message.
4. Guardrail/model failure returns existing safe fallback and cannot trigger a financial write automatically.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Telegram sender ID is memory resource; private chat ID is thread. | Telegram identity boundary |
| 2 | Store last 20 messages in existing Mastra libSQL storage. | Product decision |
| 3 | Prompt injection and prompt disclosure processors fail closed. | Security requirement |
| 4 | Finance writes still require durable explicit approval. | Existing approval policy |
| 5 | No cross-user memory access. | Security requirement |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No prior messages | Agent answers using current message only. |
| Two users act at same time | Separate resource/thread memory. |
| Process fails halfway through | Persisted completed messages survive restart; return safe fallback. |
| Quota or limit exceeded | Return safe fallback without automatic retry. |
| Guardrail unavailable | Strict processor blocks model request. |
| Existing conversation | No backfill; memory begins after deployment. |

## System impact

- Models / tables: Mastra memory tables in configured libSQL database.
- Services: Telegram chat routing and both Mastra agents.
- Jobs / queues: None.
- Endpoints / routes: Existing `/telegram/webhook`.
- Permissions & roles: Existing Telegram sender allowlist and private-chat restriction.

## Definition of done

- [x] Memory persists with stable sender/chat IDs.
- [x] Financial agent uses Mastra normalization and deterministic processors; no-tool conversational agent stays model-backed without processor model calls that could block ordinary greetings.
- [x] Finance approval behavior remains unchanged.
- [x] Tests cover memory identifiers and safe failures.
- [x] `bun test`, TypeScript validation, and `git diff --check` pass.
- [x] This spec matches shipped implementation.

## Open questions

- None.
