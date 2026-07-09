# Onboarding Week — New Client → First Module Live

Phase 3 deliverable (PLAN.md §5). The standard motion for every new client, codified against the built system. Target: **first shipped track in under 2 weeks**; Onboarding Week itself is days 1–5. Owner: the pod's GTME, with the MD on kickoff.

## Day 0 — Instance creation (30 minutes)

1. `cp -r clients/_template "clients/<Client Name>"` — the instance is born with the full memory-layer directory shape, brain stubs, and manifest.
2. Fill `client.yaml`: pod, engagement dates, `stack` (their actual tools), delivery channels. Leave `modules` mostly off — the audit decides what can turn on. `status: onboarding`.
3. Fill `_lifecycle.yaml` (engagement_start, type).
4. Commit. The instance is now visible in the ops surface.

## Day 1 — Data Audit (the gate for everything else)

5. Wire the CRM connector adapter for their stack and run the **enrichment-refresh pipeline** (`@sartre/modules`) once. It produces:
   - the Data Health Report (ops surface → Data Health tab; doubles as kickoff collateral),
   - the **MVD block** in the manifest — green/yellow/red per module with priced remediation gaps.
6. Read the module × MVD table with the MD: this is the build-order conversation. Red modules with big gaps → **remediation is the first billable track** (`revops.remediation` is never blocked).

## Days 1–3 — Brain Builder

7. Collect sources: website scrape, closed-won/lost CRM export, kickoff + discovery transcripts (ingest transcripts via `@sartre/memory` `ingestMeeting` — they land in `meetings/` and seed `insights/`).
8. Run **Brain Builder** (`@sartre/skills`): drafts `company.md`, `icp.md`, `voice.md`, `grading.md`, `use-cases.md` with `[VERIFIED]` attribution back to the sources. Anything not derivable is a TODO, not a guess.
9. **GTME review is the deliverable**: read each draft against the sources, fix, set `status: active`, `approved_by: <you>`, real `updated` date. The grading posture decision (generous vs strict) is made HERE, deliberately, with the client's tolerance in mind.
10. Hand-write what machines can't: `routing.md` (from their territory docs), `data-conventions.md` (namespace prefix, picklists), `signals.md` if signal plays are in scope.

## Days 3–5 — First module live

11. Enable the first module in `client.yaml` (typically `revops.enrichment` always-on, plus the first build track's module). MVD must be green or carry an attributed override.
12. Register the module's pipeline in the runner registry with the client's deps; set the schedule for always-on modules.
13. Run it. Work the review queue — **every approval/rejection from run #1 feeds the learning engine.** Attribution is required; reasons on rejections become exemplars.
14. Confirm in the ops surface: run journal clean, budgets tracking, health dashboard live.
15. Flip `status: active`. Kickoff follow-up to the client includes the Data Health Report and the first module's output.

## Standing cadence from week 2

- `enrichment-refresh` on schedule → contracts + drift alerts to the pod channel.
- Weekly: `proposeTuning` over the feedback log → tuning report to the GTME; approved exemplars land in `brain/learned/`.
- Graph health (`computeGraphHealth`) monthly or post-ingestion; fix orphans and promote emerging tags.
- Metrics (`metricsByPeriod`) accumulate toward the QBR: approve-without-edit climbing is the renewal chart.

## Checklist (copy into the engagement log)

```
[ ] instance from template, manifest + lifecycle filled, committed
[ ] Day-1 Data Audit run; MVD block written; build order agreed w/ MD
[ ] remediation scoped if red (priced from the MVD gaps)
[ ] transcripts ingested; brain drafted; ALL brain docs GTME-approved & active
[ ] grading posture decided and recorded in grading.md frontmatter
[ ] routing.md + data-conventions.md hand-written
[ ] first module enabled (MVD green or attributed override)
[ ] pipeline registered + scheduled; first run through review queue
[ ] budgets + delivery channels verified in ops surface
[ ] status: active; kickoff follow-up sent with Data Health Report
```
