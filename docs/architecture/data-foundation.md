# Data Foundation Persistence

Layer 7 uses three explicit boundaries; connectors never write directly into golden records.

1. **Staging** — `PostgresStagingStore` appends the raw `StagedBatch` exactly as returned by a connector. Batches are client-scoped and content-idempotent; retries do not duplicate raw data.
2. **Mapping** — a validated `SourceMapping` turns each raw row into a client-scoped `CanonicalCandidate`. Transform failures and required-field gaps are returned as problems instead of silently dropping the row. Every mapped value receives CRM provenance with connector, extraction time, confidence, and optional run ID.
3. **Golden records** — callers apply the existing normalization/entity-resolution rules to candidates before promoting them into the canonical Account, Contact, Opportunity, Activity, or Signal schemas. `PostgresCanonicalStore` validates those schemas again, preserves external IDs and per-field provenance, and exposes no delete operation. Duplicate/excluded records remain present with flags.

Both storage tables promote `client_id` to an indexed column. All adapter reads require it, and record writes reject a document whose embedded client differs from the storage scope. Dynamic source mappings belong in an active, attributed `brain/config/*.yaml` envelope and can be loaded through `FileClientBrainStore`.

CRM writeback remains a separate connector operation: it must pass the namespaced-field guard, create a source snapshot, and stop at a human `crm_write` gate before dispatch.
