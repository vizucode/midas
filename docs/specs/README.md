# specs/ — Feature Specs

Where you write **what has to be built and why**, before the code exists — and keep maintaining afterwards as the reference for how the system actually behaves.

How this differs from an [[../decisions/README|ADR]]:
- A **spec** answers _what the system does_ (flow, business rules, edge cases).
- An **ADR** answers _why it was built that way_ (technical choice, trade-offs).

One feature may have a single spec and several ADRs that link back to it.

## Rules

1. Write the spec before the implementation. Half a page is fine — what matters is that the edge cases have been thought through.
2. After release, **update** the spec when behaviour changes. A stale spec is worse than no spec.
3. "Edge cases" and "Definition of done" are mandatory sections. The rest is optional.

## Versioning convention

Specs live in a version folder matching the release that last changed their behaviour
(e.g. `v1.0.0/SPEC-my-feature.md`). Move a spec at release, not at planning time.

The `version:` frontmatter moves with the folder.

## Index

| Spec | Status | Related |
|---|---|---|
| [Telegram Finance Chat](v1.0.0/SPEC-telegram-finance-chat.md) | Draft | v1.0.0 retrospective |
| [Finance Scope and Bot Help](v1.0.0/SPEC-finance-scope-and-bot-help.md) | Draft | v1.0.0 retrospective |
| [Financial Queries and Reports](v1.0.0/SPEC-financial-queries-and-reports.md) | Draft | v1.0.0 retrospective |
| [Confirmed Financial Changes](v1.0.0/SPEC-confirmed-financial-changes.md) | Draft | v1.0.0 retrospective |
| [Mastra Financial Assistant Rebuild](v1.0.1/SPEC-mastra-rebuild.md) | Approved | v1.0.1 migration in progress |

> Add a row here every time you create a new spec.
