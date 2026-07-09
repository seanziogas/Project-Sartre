> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/frameworks/flow-plus-inventory-documentation.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: framework
date: 2026-04-22
status: active
tags: [documentation, systems-mapping, stakeholder-communication]
origin_client: Drata
origin_context: "System maps shared by Aneal (Drata leadership) after 2026-04-22 kickoff — he prefers this style and asked Kiln to document in kind"
related_concepts:
  - "[[system-maps-architecture-analysis]]"
---

# Flow + Inventory Documentation Pattern

A two-view documentation pattern for technical ecosystems, extracted from system maps used by a leadership stakeholder at a B2B SaaS client. The pattern is usable anywhere a complex tool/data/process landscape needs to be communicated to executives or cross-functional teams.

## The Pattern in One Line

**Pair a flow view (how value moves) with an inventory view (what we own) — and group both by function, not by vendor.**

Neither view alone is sufficient. Flow without inventory hides surface area; inventory without flow hides how anything connects.

## The Two Views

### View 1 — Flow Diagram

Read left-to-right (or top-to-bottom) across named **pipeline stages**. Only systems that actively participate in the flow appear. Stages are domain-specific but should be explicit and labeled.

**Example stages for a data ecosystem:**
`Sources → Ingest → Store/Transform → Analyze → Egress → Destinations`

**Example stages for a GTM motion:**
`Signals → Routing → Enrichment → Outreach → Engagement → Conversion`

**Example stages for a customer journey:**
`Acquisition → Activation → Adoption → Expansion → Retention`

Tools or components are placed on the stage they operate in. Arrows show direction of flow. A system appearing twice (e.g., at Ingest AND Egress) is meaningful — it means one vendor spans a boundary.

### View 2 — Categorical Inventory

A comprehensive grid of every tool/component, grouped into **named functional categories** (not by vendor, not by team, not by cloud). Every tool sits inside a category box. The category is the primitive; the tool is the current implementation.

**Example categories:** Marketing Automation, Revenue Operations & Intelligence, Customer Success Platform, Financial Systems & ERP, Data Warehouse, Security, AI/ML Platforms.

Unlike the flow view, the inventory shows everything — including tools that don't participate in the active pipeline. Surface area is the point.

## Why Both Are Needed

| Question | Which view answers it |
|---|---|
| "How does value move through our system?" | Flow |
| "What systems would we have to migrate if we switched cloud?" | Inventory |
| "Where is the single point of failure?" | Flow |
| "What's our total tool footprint in this function?" | Inventory |
| "Is this vendor a bridge between stages?" | Flow |
| "Do we have overlap in this category?" | Inventory |

Stakeholders ask both kinds of questions. A single diagram that tries to answer both becomes unreadable.

## Rules for Building the Diagrams

1. **Name the stages explicitly.** Label them at the top of the flow diagram. Vague flows ("things happen") are worthless.
2. **Group by function, not by vendor.** A tool's category should describe the job-to-be-done, not the brand. This makes the diagram resilient — when a tool changes, the category stays.
3. **One vendor can appear in multiple stages.** Don't hide this. If Matia is both ELT and reverse-ETL, draw it twice.
4. **Inventory shows everything; flow shows only what flows.** Don't conflate them. If a tool is owned but unused in the flow, it only appears in the inventory.
5. **Keep visuals clean.** Named boxes, simple arrows, no crossed lines where avoidable. The diagram is the artifact — it should be scannable in 30 seconds.
6. **Annotate cross-boundary systems.** If part of the system lives in a different cloud, acquisition, or org unit, visually group that region.

## When to Use This Pattern

- **Kickoff and stakeholder alignment** — giving executives a shared mental model before diving into recommendations
- **Tech stack audits** — replacing vendor lists with a two-view artifact
- **Pre-sales scoping** — showing where our proposed work sits in the client's larger ecosystem
- **Internal synthesis** — our own understanding of a client's landscape before proposing changes
- **Post-acquisition integration planning** — flow diagrams make unification gaps obvious

## When NOT to Use It

- Single-tool deep-dives (use a tool-specific structure instead)
- Pure process documentation with no tool/system component (use a process-flow or swimlane)
- Early discovery when the landscape isn't stable enough to categorize

## Generalized Example — GTM Motion

**Flow view (stages):** Signals → Routing → Enrichment → Engagement → Conversion

**Inventory view (categories):** Intent Data, Firmographic Data, Contact Data, Routing, Sequencing, Conversation Intelligence, CRM, Sales Enablement, Partner Intelligence

A given tool (e.g., a conversation-intelligence platform) appears in the "Engagement" stage of the flow and in the "Conversation Intelligence" category of the inventory. Both are true. Both are useful.

## Related Concepts

- [[system-maps-architecture-analysis]] — the Drata case study this pattern was extracted from
