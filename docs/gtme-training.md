# GTME Phase 3 enablement

This is the standard training and sign-off runbook for operating Sartre from Onboarding Week through the first live module. A GTME is production-enabled only after completing the lab and having the reviewer sign the record at the bottom.

## Learning objectives

The GTME must be able to:

1. Create a client instance from `clients/_template` without introducing real client data into git.
2. Interpret the Data Health Report and explain MVD green/yellow/red status and priced remediation gaps.
3. Review and activate Brain Builder drafts with source attribution, while leaving unknowns as TODOs.
4. Work each gate class correctly: `internal_report`, `brain_change`, `client_comms`, `crm_write`, and `outbound_send`.
5. Diagnose a parked/failed run from checkpoints and journal entries without manually bypassing the runner.
6. Explain why unexplained corrections are metrics only, why tuning proposals require known-answer evals, and why approval persists drafts rather than silently changing the brain.
7. Verify tenant boundaries, namespaced CRM fields, snapshots, budgets, and delivery destinations before approving external effects.

## 90-minute workshop

- 0–15: architecture and client boundaries; manifest, Brain, canonical data, runner, ops.
- 15–30: Day-1 audit and MVD/remediation exercise.
- 30–50: Brain Builder review and source-attribution exercise.
- 50–70: review-queue lab covering one internal report, one CRM write, and one rejected client communication with a reason.
- 70–80: learning-loop lab: reasoned vs unexplained correction, eval-pass proposal, draft-only persistence.
- 80–90: failure drill, journal diagnosis, and sign-off review.

## Required sandbox lab

Use fabricated data only. The trainee must:

- complete `docs/onboarding-week.md` through the first-module run;
- demonstrate that an unresolved gate prevents notification/write/send;
- reject a draft with a useful reason and identify the resulting exemplar draft;
- show that a failed tuning eval cannot create a brain-change proposal;
- resume an approved run through the runner path, not from the ops app;
- confirm `npm run build`, `npm test`, and `npm run typecheck` are green.

## Sign-off record

Copy this block into the internal enablement tracker; do not record client data here.

```text
GTME:
Trainer/reviewer:
Workshop date:
Sandbox client:
Onboarding lab: PASS / RETRY
Gate-safety lab: PASS / RETRY
Learning-safety lab: PASS / RETRY
Run-diagnosis lab: PASS / RETRY
Production enabled by:
Notes:
```
