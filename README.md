# Project Sartre

The Kiln's GTM Operating System — one platform, instanced per client. A configurable,
per-client go-to-market system that runs sales, marketing, and RevOps workflows: the
core is identical everywhere (repeatable, scalable, reliable), while each client's
Brain, tool connections, enabled modules, thresholds, and learned behavior make the
instance theirs.

**Status:** the Phase 0–4 platform build is complete. All 23 locked module IDs have
registered production pipelines, Postgres-backed runtime state with forced row-level
tenant isolation, structural human-approval gates on every outward effect, client-scoped
encrypted tool connections, and a learning loop. CI is green on `main`. What remains is
operational — deploying to real infrastructure and onboarding clients — not code; see
[docs/deployment-runbook.md](docs/deployment-runbook.md).

> Design rationale, the full 8-layer architecture, the module map, and the phase plan
> live in **[PLAN.md](PLAN.md)** — the canonical design spec that the readiness docs and
> ADRs map their evidence against.

## What it is

Sartre is simultaneously the **delivery platform** pods run engagements through, the
**deliverable** a client inherits at engagement end (their working machine — brain,
automations, dashboards), and the **retention engine** whose always-on modules keep
producing value between build tracks.

It is built on eight layers (full detail in [PLAN.md](PLAN.md) §3):

1. **Client Brain** — git-backed, schema-validated markdown per client (ICP, voice, grading rulebook, signals, learned artifacts) plus `client.yaml`.
2. **Integration Hub** — connectors for the mainstream GTM stack; native REST clients with an MCP transport alongside; portfolio-wide enrichment cache.
3. **Skill Library** — versioned, brain-grounded, client-agnostic skills, each with known-answer evals in CI.
4. **Pipeline Engine** — resumable runs, checkpoints, per-run token/credit budgets, run journaling, scheduled triggers, MVD gates.
5. **Ops Surface** — Next.js portal with per-client tenancy: review/approval queues, run monitoring, health, learning, governance, releases, connections.
6. **Memory Layer** — meeting ingestion, insight nodes, synthesis docs.
7. **Data Foundation** — Day-1 Data Audit, canonical data model, entity resolution, Minimum-Viable-Data gates.
8. **Learning Engine** — feedback capture and three learning speeds (instant exemplars, weekly tuning diffs, statistical optimization), all as reviewable, git-versioned changes.

## Repository layout

```
Project Sartre/
├── PLAN.md                 # canonical design spec (architecture, modules, phases)
├── packages/               # TypeScript workspaces
│   ├── core/               # shared types, canonical data model, Brain store, manifest
│   ├── connectors/         # REST + MCP connectors, credential vault, enrichment cache, benchmark
│   ├── data/               # data audit, normalization, entity resolution, MVD gates
│   ├── db/                 # Postgres adapters (real pg.Pool; PGlite in tests), forced RLS
│   ├── pipelines/          # pipeline engine: runs, checkpoints, budgets, gates, journal
│   ├── modules/            # the 23 module pipeline builders
│   ├── skills/             # agent skill library (LLM boundary + brain-grounded skills)
│   ├── learning/           # feedback events, exemplars, tuning, bandits
│   ├── memory/             # meeting ingestion + synthesis
│   ├── operations/         # governance, config releases, evaluations, telemetry, portability
│   └── shadow/             # shadow-run comparison harness
├── apps/
│   ├── runner/             # service entrypoint + CLIs (preflight, simulate, drills, seed-demo)
│   └── ops/                # Next.js ops portal (proxy-delegated auth, middleware backstop)
├── clients/_template/      # per-client instance template (tenancy boundary)
├── knowledge_base/         # shared, client-agnostic playbooks/sales/delivery/patterns
├── schemas/                # JSON Schema for Brain docs and client.yaml
├── docs/                   # architecture specs, ADRs, readiness + deployment runbooks
├── tools/                  # shadow-hologram harness, connector-bench
└── scripts/                # verify-local.sh
```

## Quickstart

Requires Node ≥ 22.

```sh
npm install
npm run build       # tsc -b across all workspaces + the ops app
npm test            # vitest (uses PGlite + scripted fakes; no live services)
npm run typecheck
npm run shadow:fake # offline shadow-run plumbing check (a CI gate)
```

These four — build, test, typecheck, shadow:fake — are the CI gates.

## Local development (clickable ops portal)

Bring up a local Postgres and seed a demo tenant with review-queue items:

```sh
docker compose up -d
export DATABASE_URL='postgres://sartre:dev@localhost:5432/sartre'
scripts/verify-local.sh        # runs the CI gates + a live DB smoke via seed-demo
```

Then follow [docs/local-dev.md](docs/local-dev.md) to start the ops app and click through
the seeded ABM / takeout / event / TAM review queue. Tear down with `docker compose down`.

## Commands

| Command | What it does |
|---|---|
| `npm run build` / `test` / `typecheck` / `shadow:fake` | The four CI gates |
| `npm run seed-demo` | Seed a local demo tenant with review-gate runs (needs `DATABASE_URL`) |
| `npm run preflight` | Validate active client manifests, approved config, brain deps, connections — no providers called |
| `npm run simulate` | Per-module dry-run readiness map |
| `npm run rotate-credentials` | Re-wrap credential envelopes to the current key |
| `npm run governance-request` / `-decide` | Governance request lifecycle (two-person for deletion/promotion) |
| `npm run restore-tenant` | Restore a checksum-verified, credential-free portability bundle into an empty target |
| `npm run record-eval` | Record an evaluation run |

`node tools/connector-bench/run.mjs <config>` benchmarks a provider's REST vs MCP transport
(see [tools/connector-bench/README.md](tools/connector-bench/README.md)).

## Non-negotiable invariants

- **Hard tenancy.** Every tenant table has `FORCE ROW LEVEL SECURITY` with a policy keyed on a transaction-local `sartre.client_id`. The app **must** connect as a restricted, non-owner, non-`BYPASSRLS` role or isolation is defeated.
- **Human gates on every outward effect.** Sends, CRM writes, enrollments, and audience syncs stop at a structural review gate before dispatch.
- **Non-destructive & auditable.** Snapshot-before-write, namespaced CRM fields, full run journal, per-field provenance.
- **Config over code.** Per-client variation lives in `client.yaml`, the Brain, and learned artifacts — never in `packages/`. Bespoke work becomes a client-scoped skill with a promotion path to core.
- **Grounded generation.** LLM-backed skills are brain-grounded with in-code guards (e.g. takeout proof must quote evidence; ABM contacts must exist on the account) and per-item token budgets; learned changes are reviewable, eval-gated diffs.

## Deployment

Deployment and per-client onboarding are operational steps that require deployment-owned
inputs (hardened Postgres, an identity proxy, a credential keyring, OAuth callbacks). The
turnkey sequence, with every step mapped to a command and the deployment-owned items flagged,
is in **[docs/deployment-runbook.md](docs/deployment-runbook.md)**. Per-client onboarding is
in [docs/onboarding-week.md](docs/onboarding-week.md).

## Documentation

- **[PLAN.md](PLAN.md)** — design spec: architecture, module map, phases, risks
- **[docs/deployment-runbook.md](docs/deployment-runbook.md)** — production deployment sequence
- **[docs/production-readiness.md](docs/production-readiness.md)** — pre-deployment checklist
- **[docs/local-dev.md](docs/local-dev.md)** — local click-through walkthrough
- **[docs/taxonomy.md](docs/taxonomy.md)** — the locked module taxonomy
- **[docs/architecture/](docs/architecture/)** — per-layer specs
- **[docs/decisions/](docs/decisions/)** — ADRs (tenancy, OAuth/credentials, control plane, module intelligence)
