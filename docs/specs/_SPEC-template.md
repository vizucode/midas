---
spec: <slug>
title: <feature name>
status: Draft   # Draft | Approved | Shipped | Deprecated
owner:
date: YYYY-MM-DD
related_adr: []
tags: [spec]
version:
---

# SPEC — <feature name>

## Problem

Who is struggling, and what the struggle looks like today. Write it from the end user's
point of view, not from the database table's.

## Scope

**In scope**
-

**Out of scope**
-

## Main flow

1.
2.
3.

## Business rules

| # | Rule | Source of truth |
|---|---|---|
| 1 | | |

## Edge cases

| Condition | Correct behaviour |
|---|---|
| No data / first-ever run | |
| Two users acting at the same time | |
| Process fails halfway through | |
| Quota or limit exceeded | |

## System impact

- Models / tables:
- Services: [[../graph/ServiceName]]
- Jobs / queues:
- Endpoints / routes:
- Permissions & roles:

## Definition of done

- [ ] Main flow works end to end
- [ ] Every edge case above is handled, or recorded as a deliberate decision
- [ ] Tests cover the critical business rules
- [ ] This spec matches the shipped implementation

## Open questions

Anything still unanswered. Leave empty once there is nothing left.
