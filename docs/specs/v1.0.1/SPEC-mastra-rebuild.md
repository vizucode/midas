---
spec: mastra-rebuild
title: Mastra Financial Assistant Rebuild
status: Approved
owner:
date: 2026-10-09
related_adr: []
tags: [spec, migration]
version: 1.0.1
---

# SPEC — Mastra Financial Assistant Rebuild

## Problem

Users need the same finance chat, reports, and explicitly confirmed financial changes when the assistant moves from LangChain to Mastra. Pending confirmations currently disappear after a restart, and stale buttons can target a newer request. Users must be able to review the exact action, make a decision safely, and receive an honest result even when a remote write has an uncertain outcome.

Implementation status: Implemented locally; live Telegram, NINE Router, and MCP verification remains required. The gateway uses npm alias `@ai-sdk/openai-compatible-v5@npm:@ai-sdk/openai-compatible@1.0.46`, matching `@mastra/core@1.75.0`. Custom Mastra webhook/approval glue owns Telegram routing because native channel cards do not expose durable application-level owner/chat/callback claims. Mastra snapshots remain persistent in libSQL. The four v1.0.0 specs remain the historical behavior baseline.

## Scope

**In scope**
- Replace LangChain/LangGraph agent execution, MCP adapter, checkpoints, and approval handling with Mastra APIs.
- Preserve NINE Router model, API key, and custom OpenAI-compatible base URL through a registered custom Mastra gateway. Do not silently switch providers or model IDs.
- Replace Telegraf with Mastra Telegram channels using `@chat-adapter/telegram` and webhook delivery.
- Configure persistent libSQL storage for Mastra approval snapshots and any channel/approval metadata necessary to rediscover and securely resume pending actions after restart.
- Preserve finance/help/refusal routing, Indonesian responses, Asia/Jakarta date context, MCP financial capabilities, argument policies, and execution limits.
- Bind approval to the exact reviewed operation and its owner; prevent stale, duplicate, or cross-user callbacks from authorizing another operation.
- Update tests, startup/configuration documentation, dependencies, and affected feature specs after implementation.

**Out of scope**
- New financial capabilities, new model provider, multi-agent orchestration, code mode, sandbox execution, semantic recall, or new LLM-backed guardrails.
- Polling delivery, additional chat platforms, or a public unauthenticated agent execution API.
- New multi-turn conversation memory as a product feature. Persistence for approval recovery does not imply retaining completed conversations indefinitely.
- Remote financial authorization redesign, remote rollback, or an exactly-once write guarantee without support from the MCP service.
- Multi-instance production with a shared local database file; production storage topology requires an explicit deployment decision.

## Main flow

1. Startup validates model, MCP, Telegram, and storage configuration; opens libSQL; registers the NINE Router gateway and financial agent on a Mastra instance; discovers MCP tools. Discovery errors prevent readiness rather than silently exposing an incomplete tool inventory.
2. Telegram delivers an update to the configured Mastra channel webhook. The application verifies the Telegram webhook secret, establishes trusted sender/chat identity, and deduplicates delivery before dispatching work.
3. Help and out-of-scope messages receive the existing deterministic reply without invoking the model or a financial tool. Supported finance text proceeds through the agent; non-text finance processing remains unsupported.
4. Mastra calls the existing NINE Router model with financial instructions and current Asia/Jakarta date context. The MCP client retains the configured endpoint and optional bearer authentication.
5. Read operations execute through validated tool policies. The agent receives usable structured results and returns a concise Indonesian response; tool failures must not be interpreted as zero balances or absent data.
6. Before a financial write, the application normalizes and validates the proposed arguments, persists the pending run, and shows a human-readable preview with explicit approve/reject controls. No write executes at this stage.
7. A decision is resolved against the exact pending run and tool call, authenticated sender/chat, and reviewed argument fingerprint. A valid decision is claimed once. Approve resumes that tool call; reject does not execute it. Additional writes require their own review.
8. Mastra completes the run or returns another approval request. Telegram displays the result. After restart, the pending run is rediscovered from persistent storage rather than from an in-memory user map.
9. Completed runs release temporary state according to the selected retention policy. Errors after a possible remote write report an unknown outcome and recommend checking records before retrying; they do not claim rollback.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Preserve `NINE_ROUTER_MODEL`, `NINE_ROUTER_API_KEY`, and `NINE_ROUTER_BASE_URL`. Use a gateway-prefixed model string on the agent; the gateway forwards the original model identifier unchanged. Provider objects belong inside gateway resolution, not the agent's `model` field. | User decision; `src/core/services/agent.service.ts:194-204`; [Custom gateways](https://mastra.ai/models/gateways/custom-gateways) |
| 2 | Use `MCPClient` from `@mastra/mcp`, retaining `MCP_SERVER_URL` and optional `MCP_SERVER_AUTH_TOKEN`. Account for `serverName_toolName` namespacing in every policy. Keep server instruction forwarding disabled; do not treat remote annotations as authorization. | `src/core/services/mcp.service.ts:5-23`; [MCPClient](https://mastra.ai/reference/tools/mcp-client) |
| 3 | Finance matching takes precedence over bot-help matching; deterministic help/refusal bypasses generation and financial tools. Channel integration must not bypass this routing. | `src/core/services/finance.guardrail.ts`; `src/core/usecases/chat.usecase.ts:138-152` |
| 4 | Preserve Indonesian response guidance, plain financial explanations, Asia/Jakarta date context, ISO-8601 tool dates, and existing calendar-versus-rolling month interpretations. These remain model instructions unless separately validated. | `src/core/services/agent.service.ts:47-61`; `src/core/usecases/chat.usecase.ts:163` |
| 5 | Preserve optional-argument cleanup, removal of `categoryGroup` from `get_records`, category-name aggregation filter cleanup, duplicate-call blocking, and usable structured tool output. Apply schema validation at the tool boundary; never change reviewed write arguments silently after approval. | `src/core/services/agent.service.ts:65-183`; [Tools](https://mastra.ai/docs/agents/tools) |
| 6 | Enforce a maximum of 30 actual tool executions per original user request, including approval continuations. `maxSteps` is a separate model-loop limit, not a substitute for counting tools. Preserve the 120-second active execution deadline and propagate cancellation where supported; waiting for a human is not active execution time. | Existing limits at `src/core/services/agent.service.ts:8,130-142` and `src/core/usecases/chat.usecase.ts:41-47,157-174`; target semantics defined by this spec |
| 7 | Every currently configured write tool requires pre-execution approval: `create_records`, `create_account`, `create_budget`, `create_category`, `create_label`, `patch_records`, `patch_accounts`, `patch_budgets`, `patch_categories`, `patch_labels`, `delete_documents`. Newly discovered unclassified tools must not execute automatically. | `src/core/services/agent.service.ts:26-38`; [Human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop) |
| 8 | Approval binds owner, chat, run ID, tool-call ID, canonical tool name/arguments, and policy version. Callback data references an opaque identifier, not financial payloads or secrets. Verify identity and pending status server-side; consume a decision atomically. | Target security requirement; [Human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop) |
| 9 | Preserve creation/deletion preview intent, but show the actual operation being authorized. Mixed accounts, dates, currencies, or transaction types must not be misrepresented by a first-record summary. Invalid preview data prevents approval rather than falling back to an uninformative authorization. | Existing formatting: `src/core/usecases/chat.usecase.ts:63-107`; target approval binding requirement |
| 10 | libSQL persists Mastra resume artifacts. Any additional Telegram decision state needed for recovery must also persist; framework snapshots alone do not establish callback ownership or deduplication. | User decision; [Storage](https://mastra.ai/docs/storage); [libSQL](https://mastra.ai/integrations/databases/libsql) |
| 11 | Approve/decline targets the exact tool call, using native Mastra approval APIs. Do not create a separate workflow merely to reproduce agent approval. Natural-language follow-ups never implicitly approve financial writes. | [Human-in-the-loop](https://mastra.ai/docs/agents/human-in-the-loop) |
| 12 | Persisted state or a failed response cannot prove a remote write did not occur. Never automatically retry an uncertain financial write unless the remote operation supports safe idempotency or reconciliation. | Known v1.0.0 failure gap; `src/core/usecases/chat.usecase.ts:52-59` |
| 13 | Telegram webhook secret validation is required. Sender/chat isolation is separate from authorization to financial data; retaining one shared MCP credential does not provide per-user financial-account isolation. Credentials, raw sensitive payloads, and database files must not enter version control or routine logs. | [Telegram integration](https://mastra.ai/integrations/channels/telegram); existing shared MCP configuration |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | Initialize storage before readiness. Empty financial results are valid only after a successful tool call; missing credentials or failed tool discovery produce actionable startup errors. |
| Two users acting at the same time | Separate request counters, pending runs, and callback ownership. A user must not resume another user's action. Same-user overlapping requests must not overwrite pending approval state. |
| Process fails halfway through | Recover pending approvals from libSQL. If a crash occurs after a decision is claimed or a write may have been sent, do not replay automatically; surface an uncertain outcome pending reconciliation. |
| Quota or limit exceeded | Stop new tool execution on budget/deadline exhaustion, request cancellation where supported, and return an honest failure. Preserve consumed budget across approval resume. |
| Invalid webhook secret or malformed update | Reject before generation or tool execution; do not log secrets. |
| Telegram retries an update or callback | Deduplicate and claim execution durably so repeated delivery cannot authorize another write. |
| Stale, wrong-user, wrong-chat, or already-used approval | Reject without resuming a run. An old button must never select the newest pending request by user ID alone. |
| Restart while approval is pending | Load the same run/tool-call identity and recover review context; loss of an in-memory map must not invalidate an otherwise valid persisted decision. |
| Multiple writes proposed together | Review each exact action; do not approve undisplayed calls by omitting `toolCallId`. |
| Arguments or policy change after preview | Invalidate prior approval and request fresh review; never execute a changed operation under old consent. |
| MCP returns `isError`, invalid structured output, or disconnects | Surface tool failure on initial and resumed runs. Do not fabricate no-data output or blindly retry non-idempotent writes. |
| MCP tool names or schemas change | Apply namespace-aware classification; block unclassified operations and invalidate approvals whose reviewed contract is no longer valid. |
| Telegram reply fails after remote write | Treat delivery failure separately from financial outcome. Do not repeat the financial operation to resend the reply. |
| libSQL unavailable or disk full | Fail closed for approval creation/consumption; do not execute writes without durable decision state. |
| Existing v1.0.0 approvals during deployment | Drain or explicitly invalidate old volatile LangGraph approvals. Do not reinterpret old generic callbacks as new Mastra approvals. |

## System impact

- Models / tables: Mastra-managed libSQL schemas for run snapshots and required channel state. Prefer native storage APIs; add minimal durable approval/delivery metadata only where native channel storage lacks ownership, atomic claims, or deduplication. Exact schema and retention remain implementation design items. Database artifacts are ignored by Git. No financial ledger migration.
- Services: `src/index.ts` runs a custom verified Telegram webhook and native Mastra agent approvals; `src/mastra/gateway.ts` registers NINE Router; `src/core/services/approval.store.ts` persists delivery dedupe, ownership, expiry, atomic decisions, budgets, and uncertain outcomes. `src/core/services/agent.service.ts`, `mcp.service.ts`, and `chat.usecase.ts` replace framework-specific execution. Obsolete Telegraf integration is removed from runtime.
- Jobs / queues: No new financial job queue. Webhook acknowledgement and background completion must follow the channel adapter's supported lifecycle. Durable state recovery does not imply automatically retrying uncertain writes.
- Endpoints / routes: Stable agent ID `financial-agent`; custom Telegram webhook `/telegram/webhook` behind public HTTPS. Validate Telegram's secret-token header, delivery ID, configured sender ID, and private-chat identity. No public Mastra agent/Studio routes are mounted.
- Permissions & roles: Telegram identity comes from validated updates, never model-supplied arguments. Check approval ownership before resume. Maintain the existing MCP authentication boundary without claiming new multi-tenant financial authorization.
- Dependencies / runtime: Replace LangChain/LangGraph and Telegraf with `@mastra/core`, `@mastra/mcp`, `@mastra/libsql`, `@libsql/client`, `hono`, and the pinned `@ai-sdk/openai-compatible-v5` npm alias. Custom Telegram webhook glue uses Telegram Bot API directly because it must atomically bind application approval ownership; `@chat-adapter/telegram` native cards were inspected but are not used for this boundary. Keep Bun tooling initially.
- Configuration: Preserve NINE Router and MCP variables; document migration from `BOT_TOKEN` to the Telegram adapter's configuration, including `TELEGRAM_BOT_TOKEN`, webhook secret, and username as required. Add an explicit storage URL and deployment webhook setup. Local file storage requires persistent disk; remote libSQL/Turso is an option, not an already-selected production topology.
- Related specs: [Telegram chat](../v1.0.0/SPEC-telegram-finance-chat.md), [finance scope/help](../v1.0.0/SPEC-finance-scope-and-bot-help.md), [financial queries](../v1.0.0/SPEC-financial-queries-and-reports.md), and [confirmed changes](../v1.0.0/SPEC-confirmed-financial-changes.md) remain historical baselines until the rebuild ships.

## Implementation checklist

- [x] Dependency compatibility checked with Bun; Mastra packages and pinned npm alias `@ai-sdk/openai-compatible-v5@npm:@ai-sdk/openai-compatible@1.0.46` installed.
- [x] Mastra Agent, MCPClient, native `requireApproval`, `generate`, `approveToolCallGenerate`, `declineToolCallGenerate`, and libSQL snapshot APIs wired.
- [x] Custom verified Telegram webhook implemented with private-chat and sender allowlist, delivery dedupe, opaque approval IDs, durable ownership, expiry, exact argument fingerprints, atomic claims, and uncertain-write handling.
- [x] Explicit read allowlist and fail-closed unknown-tool discovery implemented.
- [x] LangChain/LangGraph/Telegraf dependencies and runtime imports removed.
- [x] Local tests cover durable restart recovery, wrong-owner/chat rejection, single-use claims, delivery dedupe, exact previews, and deterministic guardrail routing.
- [ ] Main flow verified with real Telegram webhook, NINE Router, and MCP endpoint; no live external writes run in this environment.
- [ ] Every edge case above is handled, or recorded as an explicit reviewed limitation.
- [x] Custom Telegram transport, routing, approval callbacks, and security boundaries implemented; native Mastra approval methods remain execution mechanism.
- [x] NINE Router gateway preserves configured model and endpoint.
- [x] Tests cover guardrails, exact previews, durable claims, restart recovery, ownership, replay prevention, and delivery dedupe.
- [x] Startup, libSQL, MCP transport, gateway wiring, and Bun type compatibility pass local validation.
- [x] Legacy runtime dependencies removed; lockfile and startup configuration updated.
- [x] `bun test`, TypeScript validation, and `git diff --check` pass; no lint script exists.
- [x] Secrets and database artifacts excluded from version control.
- [ ] Live external integration verification and no-write staging test remain before release; live writes were not run here.

## Open questions

- What deployment host/public HTTPS base URL and persistent volume will serve the webhook? Use local file-backed libSQL on one persistent instance or remote libSQL/Turso in production?
- Native Mastra channel cards remain available for channel integrations, but this deployment uses custom Telegram webhook glue because application-level owner/chat/durable callback claims are required. Mastra `approveToolCallGenerate` remains the only resume API.
- Approval expiry defaults to 24 hours; completed approval metadata and dedupe records default to 30 days. Multiple pending approvals use opaque IDs and remain independently claimable.
- Does the MCP server support idempotency keys or outcome lookup for writes? Without either, ambiguous execution requires manual reconciliation, not automatic retry.
- What sender allowlist or deployment access policy protects the shared financial MCP credential, especially for group chats?
- Live Bun deployment compatibility with selected external NINE Router and MCP endpoints remains to be verified; local startup types and tests pass.
- Which lint command should this project adopt? Current package scripts expose tests but no lint script.

Decisions implemented: preserve NINE Router, persistent libSQL snapshots and approval metadata, custom verified Telegram webhook delivery, native Mastra approval resume methods, 24-hour approval expiry, 30-day metadata retention, private chats only, and required sender allowlist.
