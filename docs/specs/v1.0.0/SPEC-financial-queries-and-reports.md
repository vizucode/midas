---
spec: financial-queries-and-reports
title: Financial Queries and Reports
status: Draft
owner:
date: 2026-10-09
related_adr: []
tags: [spec, retrospective]
version: 1.0.0
---

# SPEC — Financial Queries and Reports

## Problem
Users need natural-language access to accounts, transactions, aggregations, and reports without knowing MCP schemas or date conventions.

## Scope

**In scope**
- Finance prompts sent to a LangChain agent with remotely discovered MCP tools (`src/core/services/agent.service.ts:40-63,194-204`).
- Date interpretation, query-shaping, duplicate-call, timeout, recursion, and tool-call controls (`src/core/usecases/chat.usecase.ts:7-21,156-174`; `src/core/services/agent.service.ts:47-61,65-183`).
- Telegram-oriented answer formatting and tool-error handling (`src/core/usecases/chat.usecase.ts:185-210`; `src/handlers/message.handler.ts:9-29`).

**Out of scope**
- Locally implemented finance calculations, guaranteed remote tool inventory, write approval behavior, and roadmap-only analytics.

## Main flow

1. Finance input receives current Asia/Jakarta date and date-resolution instructions (`src/core/usecases/chat.usecase.ts:156-170`).
2. Agent selects among tools actually returned by MCP at startup (`src/core/services/mcp.service.ts:5-18`; `src/core/services/agent.service.ts:194-204`).
3. Middleware removes empty optional arguments and enforces selected query constraints (`src/core/services/agent.service.ts:65-149`).
4. Tool responses feed the model; final response is extracted, thread cleared, then normalized for Telegram (`src/core/usecases/chat.usecase.ts:185-210`; `src/handlers/message.handler.ts:9-16`).

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Indonesian response, date semantics, category resolution, report presentation, and stop conditions are prompt-only model instructions unless a middleware rule below enforces them. | `src/core/usecases/chat.usecase.ts:162-165`; `src/core/services/agent.service.ts:47-61` |
| 2 | Middleware removes null, blank-string, and all-blank-string-array values. | `src/core/services/agent.service.ts:67-79` |
| 3 | Category grouping aggregation removes `categoryId` and `categoryGroup`; `get_records` removes `categoryGroup`. | `src/core/services/agent.service.ts:86-97` |
| 4 | Repeated category aggregations may return a synthetic success; more than one prior identical tool call is blocked. | `src/core/services/agent.service.ts:99-127` |
| 5 | Maximum observed prior tool calls is 30; agent recursion limit is also 30. | `src/core/services/agent.service.ts:8,130-143`; `src/core/usecases/chat.usecase.ts:168-173` |
| 6 | Agent execution times out after 120 seconds, but timeout races the promise and does not prove remote cancellation. | `src/core/usecases/chat.usecase.ts:7-21,157-174` |
| 7 | Tool names listed in prompts are expectations; only tools returned by `mcpClient.getTools()` are available at runtime. | `src/core/services/mcp.service.ts:12-18`; `src/core/services/agent.service.ts:45-62` |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | Prompt tells model not to report zero on tool error; no enforced local distinction between empty data and malformed successful output. |
| Two users acting at the same time | Threads use user ID, but one shared agent/MCP client serves all users; no repository-level remote data isolation guarantee exists. |
| Process fails halfway through | Tool errors are logged and return validation guidance; timeout/invocation errors reach generic handler response. Read calls may already have completed remotely. |
| Quota or limit exceeded | Middleware throws after tool budget; current handler's special-case string does not match that thrown message, leaving generic error behavior. |
| Explicit category in grouped report | Prompt says preserve explicit category ID, but middleware unconditionally strips it for `category:name` grouping; report can broaden beyond requested category (`src/core/services/agent.service.ts:53,86-93`). |
| Artifact-only tool response | Empty content with artifact is serialized to JSON for model consumption (`src/core/services/agent.service.ts:156-179`). |

## System impact

- Models / tables: Remote finance data only; none defined locally.
- Services: `src/core/services/agent.service.ts`, `src/core/services/mcp.service.ts`, `src/core/usecases/chat.usecase.ts`.
- Jobs / queues: None.
- Endpoints / routes: Outbound MCP HTTP connection configured by `MCP_SERVER_URL`; Telegram message route.
- Permissions & roles: Optional process-wide MCP bearer token; no per-user authorization enforcement in repository (`src/core/services/mcp.service.ts:9-15`).

## Definition of done

Retrospective Draft pending review, not release approval. Middleware and tool-behavior tests cover argument filtering, aggregation constraints, duplicate calls, artifacts, and configured write interruptions (`tests/core/services/agent.service.test.ts:53-246`).

- [ ] Main flow works end to end against production MCP tools.
- [x] Every edge case above is handled, or recorded as a deliberate decision.
- [ ] Tests cover date interpretation, remote-tool inventory, timeout, and budget-error integration.
- [x] This spec matches the current implementation.

## Open questions

- Which read tools and schemas does production MCP expose today?
- Should date/category prompt rules become deterministic validation where correctness matters?
- Should timeout actively cancel remote requests and align budget errors with handler messaging?
