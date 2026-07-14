# Operational control plane

The operational control plane extends Sartre without adding or renaming any locked module IDs. It covers observability, governance, configuration releases, learning oversight, and tenant portability.

## Observability and SLOs

The runner emits OTLP/HTTP JSON traces and metrics when `OTEL_EXPORTER_OTLP_ENDPOINT` is configured. Every runner tick and pipeline step is traced; attributes include tenant, run, pipeline, and step identifiers but never credentials or payload bodies. Export failures are logged and fail open, so a collector outage cannot repeat or stop delivery work.

The client Operations tab evaluates three explicit objectives from durable run state:

- completed-versus-technically-failed run success: 95% over seven days (human rejections are excluded);
- approval runs resolved or younger than 24 hours: 90%;
- nonterminal runs updated within 24 hours: 99% over seven days.

These are product defaults, not contractual promises. A deployment can route OTLP to its preferred collector, dashboard, and alerting stack.

## Governance

Each tenant can have a policy covering residency, portable-export permission, deletion grace period, and category-specific retention for runs, feedback, connections, staging, canonical records, artifacts, effects, configuration, evaluations, audit data, and Brain files.

Export, restore, retention, and deletion begin as pending requests. A human decision is stored before execution. Deletion and configuration promotion enforce separation of duties: the requester cannot approve their own action. Approval only authorizes a later operator command; it never executes the action from the portal.

Retention and deletion use allowlisted tables. Governance requests remain as the durable decision record. Brain deletion is permitted only by an approved deletion request after its configured grace period.

## Configuration releases

The Releases tab captures immutable, checksummed snapshots of `client.yaml` and `brain/config/*`. Capture validates the manifest and requires `standard-runtime.yaml` to retain its existing active, attributed human approval envelope.

Releases promote in order from development to staging to production. Each promotion is requested and separately decided. The newest active release supersedes the previous active release at that stage. When a production release exists, the runner reads its manifest and standard runtime rather than mutable working files. Structural effect gates still apply.

## Evaluation and learning control center

The Learning tab combines review metrics, draft learning artifacts, and tenant evaluation history. Learning-loop structural evaluations are recorded automatically. CI, live, or other known-answer results can be recorded with `npm run record-eval`. Failed evaluations remain visible as regressions; recording a pass never activates a draft Brain change.

## Portability

Portable bundles contain a checksummed format version, tenant files, and selected tenant database categories. Credential envelopes and environment files are structurally excluded. Export files are mode `0600`, written with create-only semantics, and land under gitignored `portability-exports/` by default.

Restore verifies the checksum, requires an approved restore request, validates `client.yaml`, refuses an existing client directory or non-empty tenant database, writes through a temporary directory, and records validation/restoration audit events. Connections must be re-established with the destination deployment's credentials.
