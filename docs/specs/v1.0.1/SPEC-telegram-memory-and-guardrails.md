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
- Persist Mastra message history in Turso using `TURSO_HOST` and `TURSO_TOKEN`.
- Configure Mastra agent memory with a `LibSQLStore` connected to Turso.
- Isolate memory by Telegram sender and private chat.
- Apply Unicode normalization and deterministic prompt-injection/system-prompt filters to the financial agent. Keep the no-tool conversational agent available without model-backed guardrail calls.
- Preserve deterministic finance routing and approval controls.

**Out of scope**
- Semantic recall, observational memory, shared group-chat memory, memory administration endpoints, or migration of earlier messages.

## Main flow

1. Startup validates `TURSO_HOST` and `TURSO_TOKEN`, then initializes Mastra storage against Turso.
2. Telegram identity supplies stable memory resource and thread IDs.
3. Model-backed request loads recent history from Turso, processes normalized input, and rejects detected injection.
4. Response is scrubbed for internal prompt disclosure and persisted with user message.
5. Guardrail, storage, or model failure returns existing safe fallback and cannot trigger a financial write automatically.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Telegram sender ID is memory resource; private chat ID is thread. | Telegram identity boundary |
| 2 | Store and load the last 20 messages through Mastra `LibSQLStore` backed by Turso. | Product decision |
| 3 | `TURSO_HOST` supplies the remote libSQL URL and `TURSO_TOKEN` supplies its auth token. Credentials are never logged or returned. | Security requirement |
| 4 | Startup fails before serving requests when either Turso credential is missing; existing approval storage configuration remains unchanged. | Reliability requirement |
| 5 | Prompt injection and prompt disclosure processors fail closed. | Security requirement |
| 6 | Finance writes still require durable explicit approval. | Existing approval policy |
| 7 | No cross-user memory access. | Security requirement |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No prior messages | Agent answers using current message only. |
| Two users act at same time | Separate resource/thread memory. |
| Process fails halfway through | Completed messages already stored in Turso survive restart; return safe fallback. |
| Turso is unavailable or rejects credentials | Service does not start; memory never falls back to local storage. |
| Quota or limit exceeded | Return safe fallback without automatic retry. |
| Guardrail unavailable | Strict processor blocks model request. |
| Existing conversation | No backfill; memory begins after deployment. |

## System impact

- Models / tables: Mastra memory tables in Turso libSQL database.
- Services: startup configuration, Telegram chat routing, and both Mastra agents.
- Configuration: required `TURSO_HOST` and `TURSO_TOKEN` for Mastra memory; `DATABASE_URL`/`DATABASE_AUTH_TOKEN` remain unchanged for approval storage.
- Jobs / queues: None.
- Endpoints / routes: Existing `/telegram/webhook`.
- Permissions & roles: Existing Telegram sender allowlist and private-chat restriction.

## Definition of done

- [x] `TURSO_HOST` and `TURSO_TOKEN` configure Mastra `LibSQLStore` for memory; approval storage remains separate unless its migration is approved.
- [x] Startup rejects missing Turso credentials without logging either value.
- [x] Memory persists with stable sender/chat IDs across a process restart.
- [x] Financial agent uses Mastra normalization and deterministic processors; no-tool conversational agent stays model-backed without processor model calls that could block ordinary greetings.
- [x] Finance approval behavior remains unchanged.
- [x] Tests cover Turso configuration, memory identifiers, persistence, and safe failures.
- [x] `bun test`, TypeScript validation, and `git diff --check` pass.
- [x] This spec matches shipped implementation.

## Open questions

- None.
