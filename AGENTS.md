# AGENTS.md — guide for contributors and coding agents

A short orientation for humans and AI coding agents (GitHub Copilot, Claude,
Cursor, …) working in **statewave-grounded-shop-assistant** — a runnable
[Statewave](https://github.com/smaramwbc/statewave) use case in TypeScript: a
grounded product advisor and support assistant for a fictional store, plus an
internal Ops Assistant that tracks and closes content gaps.

## Setup, build, test

Node 18+ (CI runs 18, 20 and 22). No API key is required.

```bash
npm ci
npm run build # tsc -b across server + packages
npm test      # tsx --test across packages/*/test and server/test
npm run seed  # ingest the catalog + service content
npm run dev   # storefront, ops console and APIs on http://localhost:4000
```

`GET /healthz` reports `completionMode`, which is the quickest way to tell
whether you are on the offline responder or a real LLM gateway.

## Layout

- `server/src/routes/` — `chat.ts` (shopper-facing) and `ops.ts` (internal console).
- `server/src/middleware/` — ops auth and rate limiting.
- `packages/chat-core/` — prompt assembly, shared types, and the completion
  backends (`offline.ts`, `openrouter.ts`, `litellm.ts`).
- `packages/statewave-core/` — the store/retrieval layer.
- `packages/chat-widget/` — the embeddable widget (built via `npm run build:widget`).
- `public/` — storefront (`index.html`) and ops console (`ops.html`).

## Conventions

- **The demo must stay clone-and-run with no API key.** The offline
  rule-based responder is the default path, and CI asserts it by booting the
  server with an empty environment and checking
  `"completionMode":"offline-rule-based"`. Don't make a provider key a
  precondition for the demo working.
- **Answers stay grounded.** Every shopper-facing answer is backed by retrieved
  evidence and cited. When evidence is missing the assistant says so and logs a
  gap — it must never fill the hole by guessing.
- **Any OpenAI-compatible gateway should work.** Keep provider wording generic;
  don't hard-code an assumption that one specific vendor is required.
- **Ops routes are protected by `OPS_API_KEY`.** If it is unset the server
  leaves `/api/ops/*` open and logs a loud warning on boot. Keep that warning
  loud, and keep the routes closed by default wherever this is deployed beyond
  localhost.
- **`npm run build` must stay clean.** The demo executes through `tsx`, so type
  errors won't stop `npm run dev` — CI runs `tsc -b` to catch them; run it
  locally before pushing.
- **Keep claims accurate and modest.** This is a demonstration use case; don't
  describe it as a production deployment.

## Pull requests

Keep PRs focused, make sure `npm run build` and `npm test` pass on Node 18+,
and check that the server still boots with an empty environment.

## Optional: give your agent memory of this repo (with Statewave)

This project dogfoods Statewave. The easiest way to give your assistant a
queryable project brain for this repo is the **Statewave IDE Companion**
extension for **VS Code / Cursor** (publisher `statewavedev`, available as a
preview) — install it from your editor's extensions marketplace. It exposes your
workspace, docs, git state, and structure to Copilot / Cursor / Claude over MCP
and **registers the MCP server for you** (no manual config); it just needs a
Statewave server to talk to (a one-file `docker compose up`). See the
[extension README](https://github.com/smaramwbc/statewave-connectors/blob/main/packages/vscode-extension/README.md).

Prefer to wire it up by hand, or use another MCP client? Run the
[Statewave MCP server](https://github.com/smaramwbc/statewave-docs/blob/main/connectors/mcp.md)
(`@statewavedev/mcp-server`) directly and query subject
`repo:smaramwbc/statewave-grounded-shop-assistant`.

<!-- statewave:begin (managed by `statewave-connectors mcp init`) -->
**Statewave memory** — MCP server `statewave`, subject `repo:smaramwbc.statewave-grounded-shop-assistant`.
Before answering questions about this project, call `statewave_get_context` (that subject, `query` = the ask) and ground your answer in it.
When the user states a durable fact or decision, call `statewave_ingest_episode` then `statewave_compile_subject` (same subject). Never invent Statewave results.
<!-- statewave:end -->
