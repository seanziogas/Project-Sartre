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

Phase 0 is COMPLETE (taxonomy locked via ADR 0001). Next: Phase 1 — integration hub big four (Salesforce + HubSpot, Clay, Slack/Teams, Fathom) + enrichment cache; data foundation core (Day-1 Audit, canonical model, entity resolution v1); first three skills (List Grader, List Enricher, Campaign Factory — blueprints in docs/architecture/skill-patterns.md); Brain Builder v1; feedback-event schema.

## Useful research already done (don't redo)

- **open-source-gtm directory review:** shortlisted Stockpile (enrichment cache), Greenware (form→Clay routing), Mold (Clay table chaining) for code-level evaluation; Zingg for later ML entity resolution; Metabase/Superset as fast dashboard v1; Multiwoven for reverse ETL; Zapier GTM Cheat Codes as skill-packaging reference. Key licensing note: n8n's Sustainable Use License blocks embedding it in a commercial product — use Activepieces (MIT core) or native pipeline code instead.

## Next action

Phase 0 (PLAN.md §5): define repo layout, Brain schema, `client.yaml` manifest, and the canonical module taxonomy — starts as soon as the source-material reference copies are available.
