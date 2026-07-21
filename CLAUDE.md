# CLAUDE.md

Guidance for working in this repo with Claude Code. See [README.md](README.md) for the
overview and [PLAN.md](PLAN.md) for the design spec. This file is the "how to work here
correctly" summary — read it before editing.

## What this is

Project Sartre — a per-client GTM operating system. TypeScript monorepo (npm workspaces,
Node ≥ 22, ESM, `tsc -b` project references, Vitest). The platform build is complete;
`main` is green. Remaining work is deployment/onboarding, not code (see
[docs/deployment-runbook.md](docs/deployment-runbook.md)).

## Commands

```sh
npm run build        # tsc -b across packages + ops app
npm test             # vitest — PGlite + scripted fakes, no live services or API keys
npm run typecheck
npm run shadow:fake  # offline shadow-run plumbing check
```

These four are the CI gates — **run them before claiming any change is done.** Run one
test file with `npx vitest run <path>`. Local Postgres + clickable portal:
`docker compose up -d` then `scripts/verify-local.sh` (see [docs/local-dev.md](docs/local-dev.md)).

## Where things live

- `packages/core` — shared types, canonical data model, Brain store, `client.yaml` manifest.
- `packages/db` — Postgres adapters (real `pg.Pool`; PGlite in tests). All schema is in the idempotent `migrate()`.
- `packages/pipelines` — the engine (runs, checkpoints, budgets, gates, journal).
- `packages/modules` — the 23 module pipeline builders.
- `packages/skills` — the LLM boundary (`LlmClient`) + brain-grounded skills.
- `packages/connectors` — REST clients, the MCP bridge, credential vault, enrichment cache, benchmark.
- `packages/{data,learning,memory,operations,shadow}` — data foundation, learning, memory, control plane, shadow harness.
- `apps/runner` — service + CLIs (`preflight`, `simulate`, `restore-tenant`, `governance-*`, `rotate-credentials`, `seed-demo`).
- `apps/ops` — Next.js ops portal.
- `clients/<name>/` — per-client instances; **the tenancy boundary**. `clients/_template` is the template.

## Invariants — do not break these

- **Forced RLS tenancy.** Every tenant table is `FORCE ROW LEVEL SECURITY`, policy keyed on transaction-local `sartre.client_id`. New tenant tables must follow the same pattern in `migrate()`. The app connects as a restricted, non-owner, non-`BYPASSRLS` role.
- **Human gates.** Every outward effect (send, CRM write, enrollment, audience sync) stops at a structural review gate before dispatch. Never add an effect that bypasses `ctx.gate(...)`.
- **Config over code.** Per-client variation lives in `client.yaml`, the Brain, or learned artifacts — never in `packages/`. Bespoke work → a client-scoped skill, not a core fork.
- **Grounded generation.** LLM skills are brain-grounded with in-code guards (e.g. `gtm-strategist` enforces evidence-quoting and contact grounding) and per-item token budgets via `ctx.spendTokensUsd`. Per-item LLM drafting must be fault-tolerant — one bad response drops that item, never the whole batch.
- **Non-destructive & auditable.** Snapshot before CRM writes; namespaced fields only; run journal + per-field provenance.

## Conventions & gotchas

- **ESM with explicit `.js` import extensions** (`from './foo.js'`), even from `.ts`. TS config is strict with `exactOptionalPropertyTypes` and `skipLibCheck` — spread optional fields conditionally rather than passing `undefined`.
- **Validate at boundaries with zod.** Untrusted connector/LLM payloads are parsed before use.
- **Tests use PGlite and a scripted fake `LlmClient`** — no live DB, no `ANTHROPIC_API_KEY`. Production model is `claude-opus-4-8`, overridable via `SARTRE_LLM_MODEL`.
- **Never hardcode dates against the real clock in tests.** Inject a fixed `now` (the `PipelineEngine`/stores accept one). A hardcoded future cutoff caused a time-rotted test failure once — don't repeat it.
- **Env:** `DATABASE_URL` (required for runner/ops); `SARTRE_CLIENTS_DIR`; `SARTRE_CREDENTIAL_ENCRYPTION_KEYS` + `SARTRE_CREDENTIAL_CURRENT_KEY_ID`; portal auth via `SARTRE_TRUSTED_AUTH_PROXY` + `SARTRE_PORTAL_ACCESS_FILE`. See `.env.example`.

## Decisions

Irreversible decisions are ADRs in `docs/decisions/` — read the relevant one before changing
tenancy (0002), OAuth/credentials (0003), the control plane (0004), or module intelligence
(0005). Add a new ADR rather than silently reversing one.
