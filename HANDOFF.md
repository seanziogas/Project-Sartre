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

- Sean to drop read-only reference copies of the source repos for Phase 0 extraction.
- ~~GitHub push~~ Done 2026-07-09: `gh auth login` completed, `main` pushed to https://github.com/seanziogas/Project-Sartre and tracking `origin/main`.
- ~~Git identity~~ Done 2026-07-09: repo-local `user.email` set to `sean.ziogas@2x.marketing` (global config untouched).
- Naming: "Project Sartre" is the codename; client-facing name TBD before Phase 4.
- Resourcing + taxonomy sign-off from Services leadership (the merged module map replaces three older track taxonomies).

## Useful research already done (don't redo)

- **open-source-gtm directory review:** shortlisted Stockpile (enrichment cache), Greenware (form→Clay routing), Mold (Clay table chaining) for code-level evaluation; Zingg for later ML entity resolution; Metabase/Superset as fast dashboard v1; Multiwoven for reverse ETL; Zapier GTM Cheat Codes as skill-packaging reference. Key licensing note: n8n's Sustainable Use License blocks embedding it in a commercial product — use Activepieces (MIT core) or native pipeline code instead.

## Next action

Phase 0 (PLAN.md §5): define repo layout, Brain schema, `client.yaml` manifest, and the canonical module taxonomy — starts as soon as the source-material reference copies are available.
