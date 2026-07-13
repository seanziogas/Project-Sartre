# V1 locked-module readiness

All 23 stable IDs from `docs/taxonomy.md` now have a registered production pipeline.

| Namespace | Pipelines |
|---|---|
| `sales.*` | outbound, ABM, reactivation, competitive takeout, copilot briefs, rep workflows |
| `marketing.*` | inbound, de-anonymization, event follow-up, copy factory, ads audience sync |
| `revops.*` | enrichment, dedup review, lead conversion, routing, TAM mapping, reporting/reverse ETL, remediation |
| `platform.*` | signal watcher, quality monitor, weekly digests, learning loop, metrics reporting |

The 13 pipelines added after Phase 4 use the same structural sequence: tenant-scoped load → deterministic/deployment-owned preparation → reviewable plan checkpoint → human gate → effect execution. Outbound activation, ABM, competitive takeout, events, and ads sync use `outbound_send`; rep workflows, routing, TAM, and ETL use `crm_write`; copy and signals use `internal_report`; digests and metrics use `client_comms`.

Their provider-specific preparation remains config-over-code: deployment resolvers use the client Brain, manifest, canonical Postgres data, and `TenantToolClients`. This keeps client mappings and destinations out of core while making gate order and resumability uniform. The client template declares every locked ID and the Day-1 audit produces MVD status for all 23.

Shared skill coverage now also includes CRM Hygiene, Reply Handler, Signal Watcher, and SOW/QBR Generator. The two LLM-backed additions—Reply Handler and SOW/QBR Generator—ship with scripted known-answer evals; unsubscribe handling, draft-only status, approved sources, and exact evidence are validated in CI.
