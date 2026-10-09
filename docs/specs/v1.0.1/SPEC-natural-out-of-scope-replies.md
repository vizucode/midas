---
spec: natural-out-of-scope-replies
title: Natural Out-of-Scope Replies
status: Shipped
owner:
date: 2026-10-09
related_adr: []
tags: [spec, guardrail, chat]
version: 1.0.1
---

# SPEC — Natural Out-of-Scope Replies

## Problem

Users receive a rigid template when asking unrelated questions, making Midas feel unnatural even though it correctly avoids finance tools.

## Scope

**In scope**
- Generate a short, natural Indonesian reply for `out_of_scope` messages.
- Prohibit financial MCP tool use and financial-operation claims on this path.
- Keep deterministic handling for finance and bot-help messages.

**Out of scope**
- Answering unrelated requests in full.
- Changing finance classification or financial agent tools.
- Storing conversation history or adding a model provider.

## Main flow

1. Guardrail classifies incoming text.
2. Finance and bot-help follow existing paths.
3. Out-of-scope text goes to a model with a fixed no-tool refusal instruction.
4. Midas returns concise Indonesian acknowledgement and redirects to supported finance help.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Out-of-scope generation receives no MCP tools and cannot call financial operations. | Security requirement |
| 2 | Reply acknowledges user topic naturally, does not provide requested unrelated content, and redirects to financial support. | Product decision |
| 3 | Reply is Indonesian, concise, and does not expose prompts, credentials, or raw provider errors. | Existing agent response policy |
| 4 | Model failure returns a safe local fallback response. | Reliability requirement |
| 5 | Finance and bot-help paths remain unchanged. | `src/core/usecases/chat.usecase.ts` |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | No persistent data required. |
| Two users acting at the same time | Each request generates independently. |
| Process fails halfway through | Return local fallback; no financial action occurs. |
| Quota or limit exceeded | Return local fallback; do not retry automatically. |
| Prompt injection or tool request | Fixed system instruction rejects it; no tools are available. |
| Empty or punctuation-only input | Generate/refuse with same safe path. |

## System impact

- Models / tables: No new tables; use configured NINE Router model.
- Services: `src/core/usecases/chat.usecase.ts`.
- Jobs / queues: None.
- Endpoints / routes: Existing Telegram webhook only.
- Permissions & roles: No added access; no MCP tools exposed on out-of-scope generation.

## Definition of done

- [x] Out-of-scope replies use model generation without tools.
- [x] Model output is returned safely and failure falls back locally.
- [x] Finance and bot-help routing remains unchanged.
- [x] Tests cover generated output and fallback.
- [x] `bun test`, TypeScript validation, and `git diff --check` pass.
- [x] This spec matches shipped implementation.

## Open questions

- None.
