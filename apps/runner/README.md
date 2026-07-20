# Runner configuration

The runner polls the same Postgres database as the ops app and registers all 23 locked production module pipelines from `@sartre/modules`.

Required environment:

- `DATABASE_URL` — shared Postgres connection string.
- `ANTHROPIC_API_KEY` — used only through `AnthropicLlmClient`; the model defaults to `claude-opus-4-8` and can be overridden with `SARTRE_LLM_MODEL`.
- `SARTRE_CLIENTS_DIR` — optional client-instance path; defaults to `clients/`.
- `SARTRE_TICK_MS` — optional polling interval; defaults to 30 seconds.
- `SARTRE_HEALTH_PORT` — optional liveness/readiness port; defaults to `3001`. `GET /healthz` reports process liveness. `GET /readyz` becomes ready after a successful runner tick, becomes unavailable after a later tick/database failure, and recovers after the next successful tick.
- `OTEL_EXPORTER_OTLP_ENDPOINT` — optional OTLP/HTTP collector base URL. `OTEL_EXPORTER_OTLP_HEADERS` is an optional JSON string map for deployment-owned authentication headers.

Connection environment:

- `SARTRE_MODULE_DEPS` — optional path to a deployment-owned ESM module exporting `createModuleDeps(context)`. When omitted, the runner uses its first-party 23-module adapter and the client's active, human-approved `brain/config/standard-runtime.yaml`.
- `SARTRE_CREDENTIAL_ENCRYPTION_KEYS` and `SARTRE_CREDENTIAL_CURRENT_KEY_ID` — versioned AES-256 keyring used to create or resolve client credentials. A legacy `SARTRE_CREDENTIAL_ENCRYPTION_KEY` remains supported during migration. No credential key is required to access Sartre or run connector-free surfaces.

The deployment adapter keeps credential-bearing connector construction outside the platform registry. It receives `{ db, brains, connections, tools }`; `brains` loads active, human-approved documents and typed config from the requested client instance. `connections` can list or resolve only the requested client's active connections. `tools` constructs tenant-scoped clients for CRM (Salesforce, HubSpot, Attio, plus read-only Pipedrive, Dynamics 365, and Zoho CRM), enrichment (Clay), collaboration (Slack, Teams), email (Gmail, Microsoft Graph), transcripts (Fathom, Gong, Fireflies, Zoom), sequencers (Smartlead, Instantly, Outreach, Salesloft, Apollo, HeyReach, lemlist, Mailshake), audiences (LinkedIn, Google, Meta), warehouses (Snowflake, BigQuery, Databricks, Redshift), intent (6sense, G2, Clearbit, Koala, Bombora), inbound sources (Qualified, LinkedIn Lead Gen, Typeform, Chili Piper), and Marketo. Credentials are decrypted only by an explicit execution-time call and are not cached. The runner owns and injects the locked production model adapter separately.

The built-in adapter reads engagement inputs from tenant-scoped `standard-input:<module-id>` runtime artifacts and writes reviewed internal output to `standard-output:<module-id>` where no external transport is appropriate. It uses canonical Postgres data for enrichment, briefs, deduplication, conversion matching, and signal persistence. External CRM writes, sequence enrollment, messages, email, audience mutations, and warehouse execution are invoked only after the pipeline's structural human gate resolves. The built-in learning evaluator rejects insufficient, uncited, active, or auto-applying proposals; accepted proposals still remain drafts behind `brain_change`.

Run `npm run preflight` from the repository root after building and setting deployment environment variables. It validates every active client’s manifest schedules, approved `standard-runtime.yaml`, module-specific configuration, required approved Brain documents, destinations, and active provider references. It reads connection summaries only: it does not decrypt credentials, refresh OAuth tokens, test providers, or execute module effects. A nonzero exit means the deployment is not ready.

Run `npm run simulate` for a read-only deployment preview. It loads active manifests, approved runtime configuration, standard inputs, and connection summaries, then prints module readiness, all structural gates and proposed effects, destinations, configured fields, audience or warehouse previews, unit costs, and budget caps. It never resolves credentials, constructs provider clients, calls a model, or executes an effect.

After making a new key ID current, run `npm run rotate-credentials`. Rotation requires the versioned keyring, rewraps only envelopes not using the current key, records an audit event per connection, and prints only the number rotated. Keep every referenced old key available until the command succeeds.

Postgres migrations enable and force tenant RLS. Use a non-owner application role without `BYPASSRLS`; the data adapters scope every tenant query transaction with `sartre.client_id`, and only explicit runner-wide operations use `sartre.system_access`.

Operational commands:

```sh
npm run record-eval -- Acme list-grader 1.2.0 24 0 live "production fixture pass"
npm run governance-request -- Acme export requester@example.com "annual backup" runs brain configuration
npm run governance-decide -- Acme REQUEST_ID approved approver@example.com
npm run governance -- execute Acme REQUEST_ID operator@example.com
npm run restore-tenant -- portability-exports/Acme.json RESTORE_REQUEST_ID operator@example.com
```

Portable exports are credential-free but still contain client data. They are written create-only with owner-only permissions and must be moved to approved encrypted storage. Restore validates the checksum and manifest, refuses existing files/data, and never restores connector credentials.

Configuration releases are captured and promoted from the portal. Promotion is ordered development → staging → production and requires a second actor. Once production exists, the runner reads the immutable promoted manifest and standard runtime; it does not silently fall back to a newer working file.

Runner lifecycle, readiness transitions, tick outcomes, invalid schedules, and runs that cannot resume are emitted as newline-delimited JSON operational events. The ops app emits the same format for connector-test success/failure; failed tests are also appended to the tenant’s connection audit history.

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

An incomplete configured deployment override still fails startup. With no override configured, the runner retains the complete production registry and resolves through `standard-runtime.yaml`; missing approved configuration, artifacts, or tenant connections fail at the specific execution boundary. It never substitutes a scripted connector or alternate model, and deployment code cannot replace the reactivation pipeline's LLM client.
