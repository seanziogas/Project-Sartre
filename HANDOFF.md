# Session Handoff — Project Sartre Context

Purpose: lets any new Claude Code session (or teammate) in this repo pick up with full context. Written 2026-07-09 at the end of the planning phase, before Phase 0.

## Where things stand

- **PLAN.md is the master build plan** — final, reviewed by Sean. Read it first; this file only covers context that isn't in it.
- The plan was derived from a deep read of three sources (local downloaded copies, since deleted):
  1. **cxt_hub** — The Kiln's internal knowledge base: 4 playbooks (CRM enrichment, outbound, inbound, GTM ops) sharing a Discovery → Scope → Build → QA spine; ICP/sales/delivery docs; pod model (MD + GTME + TOS), $18–25k/mo retainers; Clay Elite agency, acquired by 2X Jan 2026.
  2. **kiln-os** — an existing internal "Context Operating System" (v1.4, built by Carlos, handed off 2026-06-01): meeting ingestion → insight nodes → synthesis docs, lifecycle files, graph health, Notion mirrors. Sartre imports these conventions as its Memory Layer (Layer 6). Cautionary lesson from it: the TOS daily-todos workflow group was deprecated because optional internal tooling didn't get adopted.
  3. **Client workspaces (Hologram, InEight)** — the execution machinery Sartre generalizes: per-client brains (ICP, brand voice, use-case taxonomy, battlecards, case studies, grading rulebook), Claude classifier + adversarial-reviewer batch pipelines, deterministic email template engines, human QA gates, codified routing rules, exclusion/credit-budget logic.

## Decisions made (by Sean)

1. **V1 scope: internal-first, portal-ready.** Pods deliver through Sartre; the client-facing portal ships Phase 4.
2. **Fresh canonical repo** (this one) — not an extension of kiln-os.
3. **Not a replication of any one client** — a from-scratch, repeatable product deployed for every client at onboarding; configurable per client; full GTM stack (sales, marketing, RevOps); connects to the modern AI/GTM tool ecosystem.
4. **Two added first-class requirements** (now Layers 7 and 8 in PLAN.md):
   - Data Foundation — hefty data engineering so bad client data becomes a scored remediation workstream, never a blocker.
   - Learning Engine — learns from human actions (edits, approvals, overrides, outcomes) over time, per client, as reviewable diffs to the brain.
5. **Hard boundary:** cxt_hub and kiln-os are company repos — never connect to, clone, or edit them from this project. Only Project Sartre is touchable. Source material arrives as read-only local folder copies Sean provides.

## Open items (mirror of PLAN.md §10)

- ~~Source material drop~~ Done 2026-07-09: read-only copies at `/Users/sean/Documents/Internal Repo's/{cxt_hub-main, kiln-os-main}`. The Hologram/InEight workspaces live INSIDE `cxt_hub-main/clients/`. All three were deep-surveyed 2026-07-09; findings encoded in `docs/` and `schemas/` (see Phase 0 status below).
- ~~GitHub push~~ Done 2026-07-09: `gh auth login` completed, `main` pushed to https://github.com/seanziogas/Project-Sartre and tracking `origin/main`.
- ~~Git identity~~ Done 2026-07-09: repo-local `user.email` set to `sean.ziogas@2x.marketing` (global config untouched).
- Naming: "Project Sartre" is the codename; client-facing name TBD before Phase 4.
- ~~Taxonomy sign-off~~ Done 2026-07-09 (ADR 0001, decided by Sean): taxonomy LOCKED (modules = identity, SOW letters = sequencing); full module set stands for v1; ICP = $100M+ (`icp-canonical.md` governs, 2026-05 doc is reference only). Still to do: communicate the merged taxonomy to Services leadership.
- Resourcing (who builds beyond Sean + Claude Code, weekly cadence) still open.

## Phase 0 status (as of 2026-07-09)

Built from the source-material survey:
- `docs/architecture/repo-layout.md` — monorepo layout (packages/ scaffolding deferred to Phase 1).
- `docs/taxonomy.md` — canonical module IDs (`sales.* marketing.* revops.* platform.*`); key design: modules are identity, SOW track letters stay free-form sequencing. DRAFT pending Services sign-off.
- `docs/architecture/memory-layer.md` — kiln-os conventions import spec (near-wholesale; deltas table in §3).
- `docs/architecture/skill-patterns.md` — the five proven execution patterns extracted from Hologram/InEight/Drata (classifier+adversarial-reviewer, shortlist→scoped-LLM→gates, deterministic campaign factory, codified routing, exclusion-as-budget-control).
- `schemas/brain/README.md` — Brain schema v0.1; `schemas/client-manifest.schema.json` — client.yaml JSON Schema.
- `clients/_template/` — full instance template (client.yaml, _lifecycle.yaml, brain stubs, memory dirs).
- `knowledge_base/` — imported: 4 playbooks, 4 delivery docs, 6 sales docs (both ICPs, conflict flagged), pod structure, 11 kiln-os patterns/frameworks + extraction rubric. All with provenance headers.

Phase 0 is COMPLETE (taxonomy locked via ADR 0001).

## Phase 1 status (as of 2026-07-09)

Built and tested (npm workspaces monorepo; `npm test` = 71 passing):
- `@sartre/core` — canonical data model with per-field provenance; cxt_hub dedup standards as normalize functions; Layer-8 feedback events (human actions + outcomes); client.yaml zod validator with `moduleRunnable` MVD gating; brain frontmatter validator.
- `@sartre/data` — Day-1 Data Audit (0–100 health score), entity resolution v1 (deterministic waterfall + fuzzy fallback, distinct-domain disqualifier, flag-don't-delete groups), MVD gate evaluation with priced remediation gaps.
- `@sartre/connectors` — connector contract (staged reads, snapshot-before-write, namespaced-write guard) + portfolio EnrichmentCache (provenance-aware, tenancy-boundary field allowlist).
- `@sartre/skills` — LlmClient boundary (CI evals use scripted fakes; production = @anthropic-ai/sdk, claude-opus-4-8, adaptive thinking) + four skills with known-answer eval sets: **List Grader** (classify → adversarial review → retry-with-issues), **List Enricher** (cache → provider → web waterfall, credit budget, sentinels), **Campaign Factory** (deterministic two-axis template engine), **Brain Builder v1** (sources → validated draft brain docs; drafts only — human approval is structural).

- `@sartre/pipelines` (Phase 2 started early, per Sean's go-ahead to proceed without credentials) — run engine: MVD gate blocks unready modules from starting, per-step checkpointing with crash resume, hard per-run credit/token budgets, human gates driven by manifest approval policy (block/notify/auto) that park runs as awaiting_approval, gate resolutions emit Layer-8 feedback events, full run journal.
- CI: GitHub Actions runs build + all eval sets on every push/PR (first run green).

- `apps/ops` (ops surface v1, Next.js 15) — client list, per-client overview (module × MVD table incl. audit-evaluated-but-not-enabled modules with priced gaps, budget stats), review queue (approve/reject with required attribution + optional reason → gate resolution + Layer-8 feedback event to feedback-events.jsonl), run list/detail (journal, gates, spend), data health dashboard (renders the audit report). Data sources: SARTRE_CLIENTS_DIR (manifests) + SARTRE_DATA_DIR (FileRunStore, reports). **Design note: the ops surface records gate decisions; it does not resume runs — a runner service polls resolved gates and calls engine.resume(). No auth yet (internal v1).** Verified end-to-end against engine-seeded data.

- Runner service (`@sartre/pipelines` runner.ts + cron.ts) — per tick: resumes awaiting_approval runs whose gates were all decided (the ops surface writes decisions; the runner executes them) and fires cron schedules for enabled modules on active clients, once per minute-slot. In-memory fired-slot ledger (restart double-fire is bounded by gates).
- `@sartre/db` — Postgres adapters (RunStore/CacheStore/FeedbackLog) behind a `Queryable` interface compatible with pg.Pool; JSONB docs + promoted indexed columns; client_id indexed on every table (tenancy). Tested against PGlite (in-process Postgres) including the full park→decide→resume cycle.
- `@sartre/shadow` — shadow-run harness: compareGrades (band/adjacent agreement, score deltas, label agreement, top disagreements), compareRouting, compareCopy (similarity + unfilled-slot hard fails) → markdown report. Ready to consume JSON exports of manual-motion outputs whenever a real engagement's data is available.

- `@sartre/learning` (Layer 8 speeds 1–2, Phase 3 pulled forward) — extractExemplars: reasoned corrections → draft exemplar brain files (unexplained corrections are metrics, not lessons; human gate intact); proposeTuning: deterministic override-pattern analysis → evidence-carrying proposals (global/segment grading bias, routing-override clusters — the "$100M threshold" scenario is a test); gateProposals eval-gate hook (annotates, never silently drops); computeReviewMetrics + metricsByPeriod (approve-without-edit/override rates per ISO week — the QBR renewal series).

- Router skill (`@sartre/skills` router.ts) — priority-ordered rules with a condition mini-language (all/any/not, eq/in/gte/lt/exists/matches), reasoning on every decision, dual-revenue helper; 14-case known-answer eval set encoding the InEight rulebook shape.
- Quality monitoring (`@sartre/data` monitoring.ts) — data contracts (incl. contractsFromModules: enabled modules' MVD requirements become standing contracts, strictest wins) + drift alerts between audit runs (metric decay with warn/critical severities; improvement is never drift).
- Runner entrypoint (`apps/runner`) — deployable service: env-configured dirs/tick, manifest loading with per-client error isolation, graceful shutdown. Registry in `apps/runner/src/registry.ts` is where Phase 3 pipeline definitions register.

- `@sartre/modules` — production pipeline definitions with injected deps, integration-tested through the real engine: **enrichment-refresh** (pull → audit → MVD refresh for all modules → contracts+drift → notify; doubles as the Day-1 Data Audit), **closed-lost-reactivation** (grade w/ adversarial review → select → campaign factory → outbound gate carrying the review deck → enroll; nothing sends pre-approval), **inbound-routing** (enrich via cache w/ credit budget → route w/ reasoning → crm_write gate showing owner+why per lead → writeback). Register in `apps/runner/src/registry.ts` once deployment deps (connector adapters, LLM client, brain config) are wired.

**Per Sean 2026-07-09: API credentials deprioritized — test with mock data.** Remaining: live connector clients (whenever credentials appear) + deployment wiring of module deps in the runner registry; wiring `apps/ops` to @sartre/db (currently FileRunStore); live-model eval runs; shadow-run against real engagement exports (harness ready — needs the exports); memory-layer tooling (Layer 6 ingestion/graph-health as code); Onboarding Week codification.

## Useful research already done (don't redo)

- **open-source-gtm directory review:** shortlisted Stockpile (enrichment cache), Greenware (form→Clay routing), Mold (Clay table chaining) for code-level evaluation; Zingg for later ML entity resolution; Metabase/Superset as fast dashboard v1; Multiwoven for reverse ETL; Zapier GTM Cheat Codes as skill-packaging reference. Key licensing note: n8n's Sustainable Use License blocks embedding it in a commercial product — use Activepieces (MIT core) or native pipeline code instead.

## Next action

Phase 0 (PLAN.md §5): define repo layout, Brain schema, `client.yaml` manifest, and the canonical module taxonomy — starts as soon as the source-material reference copies are available.
