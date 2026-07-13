# Runner configuration

The runner polls the same Postgres database as the ops app and registers all ten production pipelines from `@sartre/modules`.

Required environment:

- `DATABASE_URL` — shared Postgres connection string.
- `ANTHROPIC_API_KEY` — used only through `AnthropicLlmClient` with `claude-opus-4-8`.
- `SARTRE_MODULE_DEPS` — path to a deployment-owned ESM module exporting `createModuleDeps(context)`.
- `SARTRE_CLIENTS_DIR` — optional client-instance path; defaults to `clients/`.
- `SARTRE_TICK_MS` — optional polling interval; defaults to 30 seconds.

The deployment module keeps credential-bearing connector construction outside the platform registry. It receives `{ db, brains }`; `brains` loads active, human-approved documents and typed config from the requested client instance. The runner owns and injects the locked production model adapter separately.

Every dependency section is a required resolver `(clientId) => deps`, so connector credentials, grading context, routing rules, templates, and destinations cannot bleed between clients:

```ts
{
  enrichment: (clientId) => RunnerEnrichmentDeps, // refreshCanonical is required in production
  reactivation: (clientId) => Omit<ReactivationDeps, 'llm'>,
  inbound: (clientId) => InboundRoutingDeps,
  remediation: (clientId) => RemediationDeps,
  copilotBriefs: (clientId) => Omit<CopilotBriefDeps, 'llm'>,
  dedup: (clientId) => DedupReviewDeps,
  leadConvert: (clientId) => LeadConvertDeps,
  deanon: (clientId) => DeanonDeps,
  learning: (clientId) => LearningLoopDeps,
  quality: (clientId) => QualityMonitorDeps,
}
```

For example, a reactivation resolver can call `brains.loadContext(clientId, [...])` for its grading constitution and `brains.loadApprovedConfig(clientId, 'reactivation.yaml', schema)` for deterministic play/template configuration. Draft or unattributed brain artifacts are rejected before a model, connector write, or outbound action runs.

The reactivation resolver must source `loadCanonicalClosedLost(clientId)` from `PostgresCanonicalStore.closedLostRows(clientId)`. Closed-lost grading cannot bypass staging, relationship resolution, or canonical tenant boundaries with a direct connector pull.

The enrichment resolver must implement `refreshCanonical` using `CanonicalIngestionCoordinator` with the client’s account/contact batches, optional opportunity/activity batches, and approved source mappings. The production runner cannot register enrichment against direct raw audit rows.

The remediation resolver loads the latest canonical health report, prepares only namespaced CRM drafts within the pipeline's pre-reserved Clay budget, and uses a `CrmWriter` that snapshots source values before the structural `crm_write` gate opens.

The copilot-brief resolver combines `PostgresCanonicalStore.briefContexts(clientId)` with approved Brain context per client. The runner injects the locked production model, and internal publication occurs only after the `internal_report` gate resolves.

The dedup resolver loads `PostgresCanonicalStore.duplicateReviewGroups(clientId)` and can prepare namespaced annotations only. The platform exposes no merge or delete operation; annotations are snapshotted and remain behind the structural `crm_write` gate.

The lead-convert resolver pulls and stages raw CRM lead batches before mapping them into tenant-tagged candidates. Planning uses exact canonical email/domain matches only; conversion requests are snapshotted and remain behind the structural `crm_write` gate.

The deanon resolver pulls and stages raw intent signal batches, then maps them into tenant-tagged events. Only exact canonical account-domain matches can become canonical signals, and persistence remains behind an `internal_report` gate. The module has no outreach, routing, or CRM-write dependency.

The learning resolver reads tenant-scoped feedback from `PostgresFeedbackLog`. It runs the relevant known-answer eval for each weekly tuning proposal and idempotently persists only draft artifacts after the `brain_change` gate. It must never activate a draft or modify an approved brain document.

The quality resolver loads the latest two health reports, refreshes machine-owned MVD state, and delivers contract/drift alerts only after the `client_comms` gate. Schedule it after the canonical enrichment refresh so it evaluates the newest report.

Startup fails when the module is absent or incomplete. The runner never falls back to an empty registry, scripted connector, or alternate model, and deployment code cannot replace the reactivation pipeline's LLM client.
