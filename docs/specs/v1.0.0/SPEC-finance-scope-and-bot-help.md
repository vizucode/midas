---
spec: finance-scope-and-bot-help
title: Finance Scope and Bot Help
status: Draft
owner:
date: 2026-10-09
related_adr: []
tags: [spec, retrospective]
version: 1.0.0
---

# SPEC — Finance Scope and Bot Help

## Problem
Users need immediate guidance for greetings and bot-help requests, while unrelated requests should not consume finance-agent execution.

## Scope

**In scope**
- Deterministic classification into `finance`, `bot_help`, or `out_of_scope` (`src/core/services/finance.guardrail.ts:15-22`).
- Fixed Indonesian help and scope responses (`src/core/usecases/chat.usecase.ts:143-152`).

**Out of scope**
- Model-based intent classification, general assistance, advisory suitability checks, and roadmap capabilities not present in source.

## Main flow

1. Input is lowercased with Indonesian locale (`src/core/services/finance.guardrail.ts:17-18`).
2. Any finance-term substring classifies as finance before help-pattern evaluation (`src/core/services/finance.guardrail.ts:20-21`).
3. Help patterns classify greetings or supported help phrases as `bot_help`; everything else is out of scope (`src/core/services/finance.guardrail.ts:10-13,21-22`).
4. Only finance-classified input reaches the agent (`src/core/usecases/chat.usecase.ts:143-158`).

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Finance terms use substring matching across listed English and Indonesian terms. | `src/core/services/finance.guardrail.ts:1-8,17-20` |
| 2 | Finance match wins over bot-help match. | `src/core/services/finance.guardrail.ts:20-21` |
| 3 | Greetings match only at message start; other help phrases can match anywhere. | `src/core/services/finance.guardrail.ts:10-13` |
| 4 | Help and out-of-scope responses are fixed locally and do not call MCP tools. | `src/core/usecases/chat.usecase.ts:146-152` |
| 5 | Claimed abilities in help text are descriptive; actual capability depends on remotely returned MCP tools. | `src/core/usecases/chat.usecase.ts:146-148`; `src/core/services/mcp.service.ts:5-18` |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | Classification is stateless and unchanged. |
| Two users acting at the same time | Classification has no shared mutable state. |
| Process fails halfway through | Local classification cannot partially write; finance-agent failures are handled elsewhere. |
| Quota or limit exceeded | Help/out-of-scope paths avoid model and MCP quotas. |
| Finance word inside unrelated text | Current substring matching may classify it as finance; token boundaries are not enforced. |
| Empty or punctuation-only input | Classified out of scope. |

## System impact

- Models / tables: None.
- Services: `src/core/services/finance.guardrail.ts`, `src/core/usecases/chat.usecase.ts`.
- Jobs / queues: None.
- Endpoints / routes: Used by Telegram message route through `handleMessage`.
- Permissions & roles: None.

## Definition of done

Retrospective Draft pending review, not release approval. Classification tests cover finance, help, and unrelated examples (`tests/core/services/finance.guardrail.test.ts:4-24`).

- [x] Main flow works through deterministic classification.
- [x] Every edge case above is handled, or recorded as a deliberate decision.
- [x] Tests cover the critical classification rules.
- [x] This spec matches the current implementation.

## Open questions

- Should classification use word boundaries or structured intent detection to reduce false positives?
- Should help text be derived from tools actually returned by the remote MCP server?
