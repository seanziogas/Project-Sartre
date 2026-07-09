# Shared Knowledge Base

Client-agnostic knowledge, maintained in Sartre. Files imported from cxt_hub / kiln-os reference copies carry a provenance header; from import day forward this repo is the living copy.

- `playbooks/` — the four Kiln playbooks (Discovery → Scope → Build → QA spine). CRM enrichment is the most complete; the other three carry known 🚧 gaps from upstream.
- `delivery/` — kickoff, weekly cadence, track delivery lifecycle (Scoped → Briefed → Built → QA'd → Shipped → Adopted), renewal/expansion.
- `sales/` — ICP, sales process, deal stages (MEDDPICC + narrative arc), offerings.
- `roles/` — pod model (MD + GTME + TOS).
- `patterns/` — anonymized cross-client patterns. **The extraction rubric in `patterns/README.md` governs all additions**: 2+ clients, portable, named trigger, real anonymization, no proprietary-ip. Extraction is proposed, never automatic.

## Known upstream conflicts (imported as-is, flagged)

1. **Two ICPs:** `sales/icp-canonical.md` targets $100M+ revenue; `sales/icp-2026-05.md` (newer, May 2026) targets $10M–$500M ARR with tiered scoring and a PE segment. Treat the 2026-05 version as current until The Kiln reconciles. Also tracked in `docs/taxonomy.md` §4.
2. **Track taxonomies:** the source docs carry four competing track enumerations. Resolved by `docs/taxonomy.md` (canonical module IDs; SOW letters stay free-form sequencing).
