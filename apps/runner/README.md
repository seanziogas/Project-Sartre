# Runner configuration

The runner polls the same Postgres database as the ops app and registers all 23 locked production module pipelines from `@sartre/modules`.

Required environment:

- `DATABASE_URL` — shared Postgres connection string.
- `ANTHROPIC_API_KEY` — used only through `AnthropicLlmClient` with `claude-opus-4-8`.
- `SARTRE_CLIENTS_DIR` — optional client-instance path; defaults to `clients/`.
- `SARTRE_TICK_MS` — optional polling interval; defaults to 30 seconds.

Connection environment:

- `SARTRE_MODULE_DEPS` — optional path to a deployment-owned ESM module exporting `createModuleDeps(context)`. The service and portal start without it; a module reports an explicit configuration error only when execution needs unresolved dependencies.
- `SARTRE_CREDENTIAL_ENCRYPTION_KEY` — 32 random bytes encoded as base64. It is required to create or use a client connection, not to access Sartre or run connector-free surfaces.

The deployment module keeps credential-bearing connector construction outside the platform registry. It receives `{ db, brains, connections, tools }`; `brains` loads active, human-approved documents and typed config from the requested client instance. `connections` can list or resolve only the requested client's active connections. `tools` constructs typed Salesforce/HubSpot CRM clients (including snapshot-before-namespaced-write), Clay enrichment, Slack/Teams delivery, Fathom transcript readers, Smartlead/Instantly enrollment clients, and LinkedIn Matched Audiences for that tenant. Credentials are decrypted only by an explicit execution-time call and are not cached. The runner owns and injects the locked production model adapter separately.

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
  outbound: (clientId) => OutboundDeps,
  abm: (clientId) => AbmDeps,
  takeout: (clientId) => TakeoutDeps,
  repWorkflows: (clientId) => Omit<RepWorkflowsDeps, 'llm'>,
  events: (clientId) => EventsDeps,
  copyFactory: (clientId) => CopyFactoryDeps,
  adsSync: (clientId) => AdsSyncDeps,
  routing: (clientId) => RoutingDeps,
  tam: (clientId) => TamDeps,
  etl: (clientId) => EtlDeps,
  signals: (clientId) => SignalsDeps,
  digests: (clientId) => DigestsDeps,
  metrics: (clientId) => Omit<MetricsDeps, 'llm'>,
}
```

The last 13 modules now expose dedicated contracts and workflows. Campaign Factory generates outbound and copy-factory drafts; Router makes revops routing decisions; Reply Handler drafts sequence responses; Signal Watcher matches approved signal rules; and SOW/QBR Generator produces grounded metrics reports. ABM, takeout, event, audience, TAM, ETL, and digest pipelines have domain-specific input and plan types. Every external effect remains after its module-appropriate human gate. Rep workflows open separate gates when a batch contains both outbound replies and CRM actions.

Machine-owned MVD state and health reports are stored per tenant in Postgres `runtime_artifacts`. The runner overlays current MVD state onto the git-backed manifest at execution time, and the ops surface reads the same state. Human-authored module configuration and approved Brain documents remain git-backed.

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

An incomplete configured deployment module still fails startup. With no module configured, the runner retains the complete production registry and defers a clear dependency error until a configured pipeline actually needs an adapter. It never substitutes a scripted connector or alternate model, and deployment code cannot replace the reactivation pipeline's LLM client.
