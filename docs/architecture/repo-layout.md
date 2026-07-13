# Repo Layout — Canonical Monorepo

Phase 0 deliverable. Defines where everything lives. Directories are created as they gain content — empty package scaffolding is deliberately deferred to Phase 1 so the layout can still flex.

## Top level

```
Project Sartre/
├── PLAN.md                  # master build plan (source of truth for scope)
├── docs/
│   ├── architecture/        # layer specs (repo-layout, memory-layer, data-foundation, …)
│   ├── decisions/           # ADRs — one file per irreversible decision
│   └── taxonomy.md          # THE canonical module taxonomy + source-taxonomy mapping
├── schemas/                 # JSON Schema definitions, versioned
│   ├── brain/               # Brain document schemas (one per brain file type)
│   └── client-manifest.schema.json   # client.yaml schema
├── knowledge_base/          # shared, client-agnostic knowledge (Layer 6's Layer-2)
│   ├── playbooks/           # imported from cxt_hub, now maintained here
│   ├── delivery/            # kickoff, cadence, track delivery, renewal
│   ├── sales/               # ICP, sales process, deal stages
│   ├── roles/               # pod model
│   └── patterns/            # anonymized cross-client patterns (extraction rubric applies)
├── clients/                 # per-client instances (hard tenancy boundary)
│   └── _template/           # instance template: brain/, client.yaml, memory dirs
├── packages/                # Phase 1+ — TypeScript workspaces
│   ├── core/                # shared types, canonical data model (accounts, contacts, opps, activities, signals)
│   ├── connectors/          # MCP connectors, one workspace per tool family
│   ├── skills/              # agent skill library; each skill ships evals/
│   ├── pipelines/           # pipeline engine: runs, checkpoints, budgets, journal
│   ├── data/                # data foundation: audit, normalization, entity resolution, MVD gates
│   ├── memory/              # memory layer tooling (ingestion, graph health, mirrors)
│   └── learning/            # feedback events, exemplar memory, tuning jobs
├── apps/
│   └── ops/                 # Phase 2+ — Next.js ops surface (portal-ready tenancy)
└── evals/                   # cross-skill eval harness + CI wiring (per-skill sets live in packages/skills/*/evals)
```

## Rules

1. **`clients/` is the tenancy boundary.** Nothing under `clients/<name>/` may be read by another client's runs. Only content passing the extraction rubric (see `knowledge_base/patterns/`) crosses into shared space — anonymized, never automatically.
2. **Brains are git-backed markdown** under `clients/<name>/brain/`, validated against `schemas/brain/`. Claude Code sessions operate on them directly; the service reads the same files.
3. **`knowledge_base/` is maintained here from now on.** Files imported from cxt_hub/kiln-os carry a provenance header; upstream repos are never touched (standing boundary, PLAN.md §10.0).
4. **Config over code:** anything that varies per client belongs in `clients/<name>/client.yaml` or the brain — never in `packages/`.
5. **Client-scoped skills** live in `clients/<name>/skills/` with the same shape as core skills; promotion to `packages/skills/` requires the pattern appearing in 2+ clients.
