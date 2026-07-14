# V1 locked-module readiness

All 23 stable IDs from `docs/taxonomy.md` now have a registered production pipeline.

| Namespace | Pipelines |
|---|---|
| `sales.*` | outbound, ABM, reactivation, competitive takeout, copilot briefs, rep workflows |
| `marketing.*` | inbound, de-anonymization, event follow-up, copy factory, ads audience sync |
| `revops.*` | enrichment, dedup review, lead conversion, routing, TAM mapping, reporting/reverse ETL, remediation |
| `platform.*` | signal watcher, quality monitor, weekly digests, learning loop, metrics reporting |

The 13 pipelines added after Phase 4 have dedicated workflow contracts rather than a generic action wrapper. Outbound and copy use Campaign Factory; routing uses Router; rep workflows use Reply Handler; signals use Signal Watcher; metrics uses the grounded SOW/QBR Generator. ABM, competitive takeout, events, ads audiences, TAM, ETL, and digests each expose typed domain plans. Every effect remains structurally gated; rep workflows require both applicable approvals when a batch mixes replies and CRM actions.

Provider-specific preparation remains config-over-code: deployment resolvers use the client Brain, manifest, canonical Postgres data, and `TenantToolClients`. The built-in resolver covers all 23 pipelines, while `SARTRE_MODULE_DEPS` remains an optional deployment override. The live client factory exposes the shared 40-provider catalog across CRM, enrichment, communications, meetings, sequencing, ads, warehouses, intent, and inbound sources. The client template declares every locked ID and the Day-1 audit produces MVD status for all 23; current machine-owned MVD and health artifacts live in tenant-scoped Postgres state.

Shared skill coverage now also includes CRM Hygiene, Reply Handler, Signal Watcher, and SOW/QBR Generator. The two LLM-backed additions—Reply Handler and SOW/QBR Generator—ship with scripted known-answer evals; unsubscribe handling, draft-only status, approved sources, and exact evidence are validated in CI.
