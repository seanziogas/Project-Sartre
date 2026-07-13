# Continuous quality monitoring

`platform.quality` is the scheduled Phase 3 quality loop. A deployment adapter supplies the latest two tenant-scoped Data Health Reports. The pipeline recalculates machine-owned MVD status for every known module, evaluates data contracts derived from enabled modules, and compares current health with the previous report.

MVD refresh is internal state and may be written directly. Any client-facing contract or drift alert stops at a `client_comms` gate, and notification happens only after approval. Stable or improving data completes silently.

The standard schedule runs after `revops.enrichment`: enrichment stages and promotes current CRM data and writes the new health report; quality then evaluates that report independently. This preserves the Day-1 audit behavior while making ongoing quality a first-class, schedulable module.
