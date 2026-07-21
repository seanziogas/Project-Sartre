# Contributing

Internal contribution guide for Project Sartre. Read [CLAUDE.md](CLAUDE.md) first — it is the
canonical "how to work here" reference (architecture map, invariants, conventions).

## Setup

Requires Node ≥ 22.

```sh
npm install
npm run build
```

## The gates (run before every PR)

```sh
npm run build
npm test
npm run typecheck
npm run shadow:fake
```

These four are exactly what CI runs. A change is not done until all four pass locally. Run a
single test file with `npx vitest run <path>`. For a live-DB check and the clickable portal,
see [docs/local-dev.md](docs/local-dev.md).

## Conventions

- **TypeScript, ESM, strict.** Explicit `.js` import extensions even from `.ts`;
  `exactOptionalPropertyTypes` is on — spread optional fields conditionally rather than
  passing `undefined`.
- **Validate untrusted input with zod** at connector/LLM boundaries.
- **Tests use PGlite and a scripted fake `LlmClient`** — no live services, no API keys. Never
  hardcode dates against the real clock; inject a fixed `now`.
- **Config over code.** Per-client behavior belongs in `client.yaml`, the Brain, or learned
  artifacts — never in `packages/`. Bespoke work becomes a client-scoped skill with a
  promotion path to core, not a core fork.
- **Respect the invariants** in CLAUDE.md — forced-RLS tenancy, human gates on outward
  effects, non-destructive auditable writes, grounded generation. Don't weaken them.

## Decisions

Irreversible architectural decisions are recorded as ADRs in `docs/decisions/`. Before
changing tenancy, credentials/OAuth, the control plane, or module intelligence, read the
relevant ADR. To change a decision, add a new ADR that supersedes it — don't reverse one
silently.

## Branches, commits, PRs

- Branch off `main`; open a PR — CI must be green to merge.
- Keep commits scoped and messages descriptive.
- Update `CHANGELOG.md` under `[Unreleased]` for user-facing or operational changes.
- Never commit secrets. `.env` is gitignored; use `.env.example` for new config keys.
