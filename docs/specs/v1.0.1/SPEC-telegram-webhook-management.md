---
spec: telegram-webhook-management
title: Telegram Webhook Management API
status: Implemented
owner:
date: 2026-10-09
related_adr: []
tags: [spec, telegram, operations]
version: 1.0.1
---

# SPEC — Telegram Webhook Management API

## Problem

Operators currently register, inspect, or remove the Telegram webhook by manually calling Telegram's Bot API. They want to manage webhook lifecycle through Midas endpoints without copying the bot token into ad hoc commands.

## Scope

**In scope**
- Add authenticated Midas routes to set, delete, and inspect Telegram webhook configuration through Telegram Bot API.
- Set webhook using configured `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET_TOKEN`; restrict allowed updates to `message` and `callback_query`.
- Return Telegram API success or actionable failure without exposing bot token or secret.
- Document routes, authentication, request/response, and operational sequence in README.

**Out of scope**
- Public unauthenticated webhook administration.
- Changing the message webhook route, polling support, or Telegram bot identity.
- Returning Telegram secret/token values or configuring arbitrary webhook URLs per request.

## Main flow

1. Operator authenticates to the Midas management API.
2. Operator calls set, delete, or info route.
3. Midas validates operation/configuration, calls corresponding Telegram Bot API method, and returns a sanitized result.
4. Operator verifies `getWebhookInfo` reports configured URL before relying on webhook delivery.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | Set operation uses only configured `TELEGRAM_WEBHOOK_URL` and `TELEGRAM_WEBHOOK_SECRET_TOKEN`; URL must be HTTPS and point to `/telegram/webhook`. | `src/index.ts:13,33`; `README.md:63-81` |
| 2 | Set operation permits only `message` and `callback_query` update types. | Current Telegram webhook registration instructions in `README.md:90-94` |
| 3 | Delete operation removes Telegram's webhook; it does not stop Midas service or delete its local database. | Telegram Bot API `deleteWebhook` semantics |
| 4 | Info operation returns Telegram's webhook status, but redacts credentials and does not return configured secret. | Telegram Bot API `getWebhookInfo` semantics; security requirement |
| 5 | All management routes require a separate configured bearer token; absent or invalid authorization is rejected before Telegram API calls. | Security requirement; current application has no management authentication |
| 6 | Telegram API failures return non-success status and sanitized error details; no secrets or full credential-bearing request URLs are logged or returned. | Security requirement |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No configured bot credentials or webhook URL | Set returns configuration error; info/delete report missing bot credentials without attempting Telegram call. |
| Two operators act at same time | Telegram's latest successful set/delete takes effect; return each operation's Telegram result. |
| Process fails halfway through | Return an error if Telegram response is unavailable; operator can call info to determine resulting webhook state. |
| Quota or limit exceeded | Propagate sanitized Telegram rate-limit/error status; do not retry destructive or state-changing operations automatically. |
| Unauthorized request | Return 401/403 and make no Telegram API call. |
| Invalid/non-HTTPS URL | Reject set request before contacting Telegram. |
| Telegram API unavailable or rejects operation | Return sanitized failure; do not claim webhook state changed. |
| Info returns pending updates or last error | Return operational fields, redact any sensitive URL components if present, and leave interpretation to operator. |

## System impact

- Models / tables: None.
- Services: Telegram Bot API management client in `src/index.ts` or a small Telegram operations service.
- Jobs / queues: None.
- Endpoints / routes: `POST /admin/telegram/webhook` (set), `DELETE /admin/telegram/webhook` (delete), `GET /admin/telegram/webhook` (info).
- Permissions & roles: Dedicated `TELEGRAM_ADMIN_TOKEN` bearer credential; not the webhook secret. Store only in deployment environment. Restrict management endpoints at network layer where available.

## Definition of done

- [x] All three routes work against Telegram Bot API with mocked HTTP tests.
- [x] Bearer auth rejects missing/invalid credentials before upstream calls.
- [x] Set validates HTTPS URL and uses configured secret and allowed updates.
- [x] Delete and info call correct Bot API methods.
- [x] Responses and logs redact bot token and webhook secret.
- [x] README documents setup, route usage, security, and verification.
- [x] Existing Telegram message webhook behavior and tests remain unchanged.
- [x] `bun test`, TypeScript validation, and `git diff --check` pass.
- [x] This spec matches the shipped implementation.

## Open questions

- None. Approved POST/GET/DELETE routes with dedicated `TELEGRAM_ADMIN_TOKEN`; unset token returns 401 without preventing service startup.
