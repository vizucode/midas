# Agent Instructions

## Feature planning

Before implementing any feature or non-trivial change:

1. Create a feature spec in `docs/specs/` before writing code.
2. Use `docs/specs/_SPEC-template.md` as the required template.
3. Name the file `SPEC-<slug>.md` and keep it in the current release folder under `docs/specs/` when one exists.
4. Complete `Problem`, `Scope`, `Main flow`, `Business rules`, `Edge cases`, `System impact`, `Definition of done`, and `Open questions`.
5. Update `docs/specs/README.md` with the new spec.
6. Present the plan and unresolved questions before implementation. Do not write implementation code until the plan is approved.
7. Update the spec when implementation changes behavior.

Bug fixes and trivial changes may skip a spec when behavior and scope are obvious.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

When the user types `/graphify`, use the installed graphify skill or instructions before doing anything else.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- Dirty graphify-out/ files are expected after hooks or incremental updates; dirty graph files are not a reason to skip graphify. Only skip graphify if the task is about stale or incorrect graph output, or the user explicitly says not to use it.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
