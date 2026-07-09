# ADR 0001 — Taxonomy model, v1 module scope, ICP sizing

**Date:** 2026-07-09 · **Decided by:** Sean · **Status:** Accepted

## Context

Phase 0 surfaced three open questions (`docs/taxonomy.md` §4, `knowledge_base/README.md`): whether SOW track letters stay free-form over canonical module IDs, whether thin-evidence modules should be cut from v1, and which of cxt_hub's two conflicting ICPs governs.

## Decisions

1. **Modules are identity; tracks are sequencing.** Canonical module IDs (`sales.*`, `marketing.*`, `revops.*`, `platform.*`) are the stable internal taxonomy; SOW track letters remain free-form per engagement, exactly as practiced in real SOWs today. `client.yaml` enables modules; SOWs sell tracks composed of them.
2. **Full module set stands for v1.** Nothing cut — including `marketing.ads-sync` and `sales.takeout` despite thin source evidence. Re-evaluate later if they stay unused.
3. **ICP focuses on $100M+ revenue.** `knowledge_base/sales/icp-canonical.md` is current. The May-2026 ICP ($10M–$500M ARR) is reference only; its tiered-scoring mechanics may inform `revops.tam` design, its sizing does not.

## Consequences

- `docs/taxonomy.md` moves DRAFT → LOCKED; it replaces the four upstream taxonomies as internal source of truth (client-facing docs still avoid the word "taxonomy").
- Brain Builder and default brain content anchor on the $100M+ ICP.
- Phase 1 can start without further taxonomy dependencies.
