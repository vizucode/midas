---
spec: readable-code-structure
title: Readable Code Structure
status: Approved
owner:
date: 2026-10-09
related_adr: []
tags: [spec, refactor, maintainability]
version: 1.0.1
---

# SPEC — Readable Code Structure

## Problem

Midas behavior works, but operators and contributors cannot easily inspect or safely modify it. Startup setup, Telegram routes, agent construction, guardrails, webhook administration, and approval execution contain long expressions and dense one-line branches. This makes review, debugging, and onboarding harder.

## Scope

**In scope**
- Reformat dense expressions and one-line control flow into named, multi-line functions and values.
- Split startup composition from HTTP routes and Telegram update handling.
- Split agent instructions, guardrail configuration, tool classification, and MCP-tool adaptation into readable modules where this reduces complexity.
- Preserve public routes, environment variables, database schema, Telegram payload behavior, Mastra setup, security controls, and approval semantics.
- Add focused tests where extraction creates new independently testable behavior.

**Out of scope**
- New product features, routes, environment variables, dependencies, database migrations, or model changes.
- Changing financial tool authorization, memory retention, guardrail policy, webhook management behavior, or reply wording.
- Broad architecture rewrites or framework replacement.

## Main flow

1. Identify dense code in application bootstrap, Telegram transport, agent construction, and approval orchestration.
2. Extract cohesive helpers with explicit inputs, outputs, and names matching existing behavior.
3. Expand remaining branches and object construction into readable multi-line statements.
4. Run regression tests, type validation, formatting/lint commands available in the project, and diff validation.
5. Compare HTTP routes, Telegram flows, and approval behavior before and after refactor.

### Implementation order

1. **Baseline:** record current tests and typecheck results, inspect working-tree changes, and add characterization checks for route authentication, chat routing, and approval ownership before moving code. Record discovered bugs separately rather than fixing them inside this refactor.
2. **Mechanical readability pass:** expand function bodies, `if` branches, loops, `try/catch/finally`, nested object literals, and multi-statement lines across `src/` and corresponding tests. Use braces, one declaration per statement, descriptive parameter names, and named intermediate values for complex conditions. Keep straightforward imports and assignments on one line; do not change prompt string contents or SQL semantics while reformatting.
3. **Application boundary:** keep `src/index.ts` responsible for startup wiring, listening, and shutdown. Extract Telegram routes and outbound Telegram requests into focused modules only where their responsibilities are distinct. Pass existing dependencies explicitly; route modules must not start the server or open databases on import.
4. **Agent boundary:** make agent settings, instructions, memory configuration, and guardrails readable. Separate MCP tool adaptation from agent construction where necessary, preserving execution order, schemas, approval flags, and contract serialization exactly.
5. **Core flow:** expand chat generation, timeout handling, approval decisions, and database transitions into sequential steps. Format SQL and arguments for review without changing transactions, query order, cleanup, retry behavior, or resource lifetime. Cover gateway, MCP client, webhook management, and logging code in the same readability pass.
6. **Validation:** run `bun test`, `bunx tsc --noEmit`, existing lint/format commands if configured, and `git diff --check` after each logical stage. Review final diff for accidental behavior changes, then run `graphify update .`. Do not make real financial writes during verification.

### Readability conventions

- Multi-line bodies for functions, methods, callbacks, and control flow; no compressed executable one-liners.
- Avoid nested ternaries and long chained transformations when named steps make intent clearer.
- Prefer names such as `telegramUpdate`, `ownerId`, `chatId`, and `approvalId` over ambiguous abbreviations outside framework conventions.
- Keep related behavior together; do not create one file per trivial helper or new service/factory layers solely for organization.
- Preserve existing indentation and dependency choices. No new formatter dependency without approval.
- Use names and structure to explain code rather than adding comments or changing behavior.
- Keep tests readable with explicit arrange, action, and assertion sections separated by whitespace.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Refactor must not change externally observable route, payload, auth, or environment-variable behavior. | `src/index.ts` |
| 2 | Financial writes still require existing durable approval before MCP execution. | `src/core/services/approval.store.ts`; `src/core/services/agent.service.ts` |
| 3 | Telegram sender/chat isolation and private-chat allowlist behavior remains unchanged. | `src/index.ts` |
| 4 | Management endpoints retain dedicated bearer authentication and credential redaction. | `src/services/telegram-webhook.service.ts` |
| 5 | Readability takes priority over minimizing line count; no dense one-line control flow or compound setup expressions in touched code. | Product decision |
| 6 | New helpers must express one responsibility and retain existing error handling. | Product decision |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | Existing database initialization and empty-memory behavior remain unchanged. |
| Two users acting at the same time | Existing per-owner and per-chat isolation remains unchanged. |
| Process fails halfway through | Existing error propagation, approval failure recording, and shutdown behavior remain unchanged. |
| Quota or limit exceeded | Existing upstream errors and safe local fallbacks remain unchanged. |
| Invalid Telegram update | Continue returning successful ignored-update response without external side effects. |
| MCP server unavailable | Startup and runtime failure behavior remains unchanged unless an existing test exposes a defect. |

## System impact

- Models / tables: None; no migration.
- Services: `src/index.ts`, `src/core/services/agent.service.ts`, `src/core/usecases/chat.usecase.ts`, and related Telegram/MCP services only where extraction improves readability.
- Jobs / queues: None.
- Endpoints / routes: Same routes and methods.
- Permissions & roles: Same Telegram allowlist, webhook secret, and admin bearer token requirements.

## Definition of done

- [ ] Touched production code has no dense one-line branches, setup chains, or compound callbacks that obscure behavior.
- [ ] Bootstrap, Telegram handling, and agent construction use named cohesive helpers/modules.
- [ ] Public behavior, security checks, and approval flow remain unchanged.
- [ ] Tests cover extracted behavior where practical and existing tests remain green.
- [ ] `bun test`, TypeScript validation, available lint/format validation, and `git diff --check` pass.
- [ ] Graphify knowledge graph is updated.
- [ ] This spec matches shipped implementation.

## Open questions

- Approved: small focused modules for routes and bootstrap where responsibilities are distinct.
- Formatting remains manual with existing style; no new formatter dependency without approval.
- Remaining implementation: route/bootstrap separation, remaining core/store/service readability passes, and characterization checks. Initial pass expanded bootstrap and agent construction and extracted the Telegram client.
