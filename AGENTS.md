# AGENTS.md

Guidance for AI coding agents (Codex, and others that read `AGENTS.md`) working in this
repo. The full, canonical agent guidance is in **[CLAUDE.md](CLAUDE.md)** — read it. This
file mirrors the essentials so no tool is left without them.

## Project

Project Sartre — a per-client GTM operating system. TypeScript monorepo (npm workspaces,
Node ≥ 22, ESM, `tsc -b`, Vitest). Platform build is complete; `main` is green. Overview in
[README.md](README.md); design spec in [PLAN.md](PLAN.md).

## Commands (run the four gates before claiming done)

```sh
npm run build
npm test             # PGlite + scripted fakes — no live services or API keys
npm run typecheck
npm run shadow:fake
```

Single test: `npx vitest run <path>`. Local Postgres + portal: `docker compose up -d` then
`scripts/verify-local.sh` (see [docs/local-dev.md](docs/local-dev.md)).

## Invariants — do not break

- **Forced RLS tenancy** on every tenant table, keyed on transaction-local `sartre.client_id`; the app connects as a restricted, non-owner, non-`BYPASSRLS` role.
- **Human gates** on every outward effect — never dispatch a send/CRM-write/enrollment/sync without `ctx.gate(...)`.
- **Config over code** — per-client variation lives in `client.yaml`/Brain/learned artifacts, never in `packages/`.
- **Grounded generation** — LLM skills are brain-grounded with in-code guards and per-item token budgets; per-item drafting is fault-tolerant (one bad response drops that item, not the batch).
- **Non-destructive & auditable** — snapshot before CRM writes, namespaced fields, run journal, provenance.

## Conventions

ESM with explicit `.js` import extensions; strict TS (`exactOptionalPropertyTypes`); validate
untrusted payloads with zod at boundaries; never hardcode dates against the real clock in
tests (inject a fixed `now`). Irreversible decisions are ADRs in `docs/decisions/` — add a new
one rather than reversing silently. See [CLAUDE.md](CLAUDE.md) for the full detail and the
per-package map.
