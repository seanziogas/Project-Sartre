# Lead-to-contact conversion

`revops.lead-convert` treats CRM conversion as a state-changing operation, not a normalization shortcut. Raw leads first land in client-scoped staging with `object: lead`; deployment mapping produces tenant-tagged `LeadCandidate` values while accounts and contacts come from the canonical store.

Planning is deterministic and exact-match only. A normalized email already present on a canonical contact is skipped. A normalized company domain may target exactly one non-excluded, non-duplicate canonical account carrying an external ID for the same CRM. A new-account conversion requires a valid email, valid domain, and company name. Missing identifiers, ambiguous accounts, duplicate source IDs, opted-out records, and all cross-client references are manual-review or hard-boundary failures. Fuzzy matching never triggers conversion.

Conversion requests use a dedicated connector contract that requires exactly one of an existing target account or new-account creation. The pipeline snapshots source leads once, presents the complete plan—including skipped and manual decisions—at a structural `crm_write` gate, and calls the converter only after attributed approval. Manual-only batches use an `internal_report` gate and never call the conversion connector.
