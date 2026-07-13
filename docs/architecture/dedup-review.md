# Dedup review

`revops.dedup` operationalizes the existing deterministic entity-resolution waterfall without changing its flag-don't-delete posture. `PostgresCanonicalStore.duplicateReviewGroups(clientId)` projects persisted duplicate flags into tenant-scoped account/contact review groups with match reason, confidence, labels, and source external IDs. Excluded records never enter a group.

The pipeline dependency can prepare namespaced annotations for reviewed members only. Runtime checks reject non-namespaced fields, opportunities, empty annotations, and any external ID not present in the review deck. The connector surface contains no merge or delete operation.

Valid annotations are snapshotted once, shown with `destructiveActions: false` at a structural `crm_write` gate, and dispatched only after an attributed approval. Gate resume skips projection, preparation, and snapshot checkpoints, so no source read or side effect repeats.
