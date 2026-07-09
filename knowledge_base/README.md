# Shared Knowledge Base

Client-agnostic knowledge, maintained in Sartre. Files imported from cxt_hub / kiln-os reference copies carry a provenance header; from import day forward this repo is the living copy.

- `playbooks/` — the four Kiln playbooks (Discovery → Scope → Build → QA spine). CRM enrichment is the most complete; the other three carry known 🚧 gaps from upstream.
- `delivery/` — kickoff, weekly cadence, track delivery lifecycle (Scoped → Briefed → Built → QA'd → Shipped → Adopted), renewal/expansion.
- `sales/` — ICP, sales process, deal stages (MEDDPICC + narrative arc), offerings.
- `roles/` — pod model (MD + GTME + TOS).
- `patterns/` — anonymized cross-client patterns. **The extraction rubric in `patterns/README.md` governs all additions**: 2+ clients, portable, named trigger, real anonymization, no proprietary-ip. Extraction is proposed, never automatic.

## Upstream conflicts — resolved (ADR 0001, 2026-07-09)

1. **Two ICPs:** resolved — **`sales/icp-canonical.md` ($100M+ revenue) is current.** `sales/icp-2026-05.md` ($10M–$500M ARR) is reference only; its tiered-scoring mechanics may inform TAM scoring design, its sizing does not govern.
2. **Track taxonomies:** the source docs carry four competing track enumerations. Resolved by `docs/taxonomy.md` (canonical module IDs; SOW letters stay free-form sequencing). Locked.
