# Hologram Shadow-Run

The first real validation (PLAN.md Phase 2 exit criterion, adapted per Sean's
mock-data directive): re-grade Hologram's human-graded connectivity list
(144 accounts, A/B/C/D/X fits) with Sartre's List Grader and measure agreement.

**Client data never enters the repo** — fixtures and outputs live in
`shadow-runs/` (gitignored). Only this harness is committed.

## Run it

```sh
npm run build                                   # once
node tools/shadow-hologram/build-fixtures.mjs   # reads the read-only reference copy
node tools/shadow-hologram/run.mjs --fake       # plumbing check, no API needed
node tools/shadow-hologram/run.mjs --fake --synthetic # CI-safe check with non-client fixtures
node tools/shadow-hologram/run.mjs              # LIVE — needs credentials (below)
```

Live runs need SDK-resolvable credentials: `export ANTHROPIC_API_KEY=...` or
`ant auth login`. Full 144 rows ≈ 8 batches × (classifier + adversarial
reviewer) on claude-opus-4-8 — roughly $3–6 and a few minutes. `--sample 40`
for a cheaper first pass.

## Reading the result

`shadow-runs/hologram/report.md` — band agreement (exact + within-one-band)
against the human grades, and the ranked disagreement table. Review the
disagreements with the GTME who graded the list: some will be machine errors
(feed the grading rulebook), some will be human inconsistency (the machine's
case). Both outcomes are the point.
