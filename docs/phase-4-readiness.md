# Phase 4 readiness record

| PLAN deliverable | Repository evidence |
|---|---|
| Client-facing approval queues | Trusted-proxy authentication, tenant grants, role-specific gate authorization, authenticated reviewer attribution |
| Client health dashboards | Authorized overview/health/run pages with MVD gaps, budgets, subscription, and learning trust metrics |
| Copilot chat over the Brain | Read-only `brainCopilot` skill and portal surface using only active approved docs with exact-evidence citations |
| Learning speed 3 | Evaluated Thompson-allocation and ICP-calibration drafts inside `platform.learning`, blocked by `brain_change` |
| Commercial layer | Manifest subscription status, module entitlements, seats/renewal metadata, and commercial checks on start/resume/approval/copilot |
| Client-owned tool connections | Portal access is connector-independent; authorized client operators can add/revoke tenant-scoped encrypted credentials, resolved only at module execution time |

Deployment still requires an identity proxy, real access grants, `DATABASE_URL`, and—only for live copilot requests—`ANTHROPIC_API_KEY`. Tool connections additionally require a deployment-held `SARTRE_CREDENTIAL_ENCRYPTION_KEY`; the portal itself does not. CI uses scripted LLM fakes and contains no credentials or client data.
