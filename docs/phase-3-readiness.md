# Phase 3 readiness record

Build-side Phase 3 scope from `PLAN.md` is mapped below. Operational rollout uses `docs/onboarding-week.md` and `docs/gtme-training.md`.

| PLAN deliverable | Repository evidence |
|---|---|
| Inbound aggregation/scoring/routing | `marketing.inbound` pipeline: cached enrichment, deterministic rule evaluation with reasoning, gated CRM assignment |
| Website de-anonymization | `marketing.deanon`: staged signals, exact tenant/domain resolution, gated canonical persistence |
| Copilot briefs | `sales.copilot-briefs`: canonical + approved Brain grounding, scripted-fake evals, internal gate |
| CRM enrichment + hygiene | `revops.enrichment` scheduled canonical refresh/audit plus non-destructive `revops.dedup` |
| Lead-to-contact | `revops.lead-convert`: exact matching, snapshot, gated conversion |
| Data remediation | `revops.remediation`: priced gaps, namespaced writes, snapshot, CRM gate |
| Learning speeds 1–2 | `platform.learning`: reasoned exemplar drafts and eval-gated weekly tuning drafts behind `brain_change` |
| Continuous quality | `platform.quality`: scheduled MVD/contracts/drift pipeline behind `client_comms` |
| Standard onboarding | `docs/onboarding-week.md` and the client template schedules |
| Train GTMEs | `docs/gtme-training.md` workshop, sandbox lab, and sign-off rubric |

External completion evidence—named trainees and trainer sign-offs—belongs in the internal enablement tracker, not this public/product repository.
