# Canonical Module Taxonomy

Phase 0 deliverable. Merges the competing track taxonomies found in cxt_hub into one canonical module set (the PLAN.md §4 module map, now with stable IDs), and maps every source taxonomy onto it.

**Status: DRAFT — requires sign-off from Services leadership** (PLAN.md §10.4), since it replaces the taxonomies below as the internal source of truth.

> Client-facing note: cxt_hub's SOW skill explicitly bans the word "taxonomy" in client documents (`team/sales/create-sow/SKILL.md`). This doc is internal; SOWs keep using "tracks" with per-engagement letters.

---

## 1. The problem being solved

cxt_hub contains **four competing enumerations** of what The Kiln builds, plus a fifth wrinkle:

| # | Taxonomy | Where | Items |
|---|---|---|---|
| A | "Four Core Use Cases" | `company/01_overview.md`, all 4 playbooks, TOS role docs | Outbound Automation · Inbound Lead Automation · CRM Enrichment · GTM Ops Automation |
| B | "GTM Engineering Tracks 0 + A–G" | `team/sales/revenue-resources/current-offerings.md` | Kickoff · Data Foundation & CRM Enrichment · TAM Mapping & Account Scoring · Signal Infrastructure · Inbound Enrichment & Routing · Outbound Automation & GTM Co-Pilot · Systems Integration & Reverse ETL · Rep Workflow & Daily Prep |
| C | "Eight Main Workstreams" | `team/sales/revenue-resources/what-we-sell.md` | TAM Mapping · CRM Enrichment + Prioritization · Persona Classification + GTM Plays · Outbound Automation · Inbound Enrichment + Routing · Rep Workflows + Daily Prep · Event + Partner Outreach · Systems Integration + Reverse ETL |
| D | "SOW Tracks 0 + A–D" | `team/sales/create-sow/SKILL.md`, `TIMELINE_REFERENCE.md` | Kickoff · CRM Enrichment & Data Foundation · Inbound Lead Enrichment/Routing/Scoring · Account Intelligence & Pre-Meeting Automation · Inbound Aggregation & De-Anonymization |
| — | Real SOWs | `sample-sows/` (e.g. Harvey) | Track letters are **ad-hoc sequencing labels** applied to bespoke scopes; only Track 0 is fixed |

The letters conflict directly (Taxonomy B's Track B = TAM Mapping; Taxonomy D's Track B = Inbound). The real-SOW finding settles the design: **track letters are engagement sequencing, not identity.** So Sartre separates the two concepts:

- **Module** — a stable, buildable capability with an ID, MVD requirements, and skills behind it. Canonical, never renamed per client.
- **Track** — a scoped, lettered unit of delivery inside one engagement, composed of one or more modules (or a client-scoped skill). Letters stay free-form per SOW, as today.

`client.yaml` enables **modules**; SOWs sell **tracks** that reference module IDs.

---

## 2. Canonical module set

IDs are stable and namespaced by GTM function. "Always-on" is a deployment mode (a module flagged `always_on` in the manifest), not a fourth namespace — the always-on set from PLAN.md §4 maps to the starred modules below.

### sales.*

| ID | Module | Notes |
|---|---|---|
| `sales.outbound` | Outbound engine | Lookalikes, signal-triggered, list-based; the four outbound patterns from the playbook are configurations of this module |
| `sales.abm` | ABM plays | |
| `sales.reactivation` | Closed-lost reactivation | |
| `sales.takeout` | Competitive takeout | |
| `sales.copilot-briefs` ★ | Copilot briefs + named-account digests | Pre-meeting intelligence; weekly digest is its always-on mode |
| `sales.rep-workflows` | Rep workflows | Post-call CRM updates, handoffs, daily prep |

### marketing.*

| ID | Module | Notes |
|---|---|---|
| `marketing.inbound` | Inbound aggregation, scoring, routing | Aggregate → Enrich → Score → Route architecture |
| `marketing.deanon` | Website de-anonymization | |
| `marketing.events` | Event/webinar/partner follow-up | Absorbs Taxonomy C's "Event + Partner Outreach" |
| `marketing.copy-factory` | Campaign copy factory | Deterministic template engine + review deck |
| `marketing.ads-sync` | Ads audience sync | |

### revops.*

| ID | Module | Notes |
|---|---|---|
| `revops.enrichment` ★ | CRM enrichment + hygiene | Backup → Standardize → Pre-Enrich → Dedup → Enrich → Maintain; scheduled hygiene is its always-on mode |
| `revops.dedup` | Dedup flagging | Mark-don't-delete; the cxt_hub dedup standards table is the default ruleset |
| `revops.lead-convert` | Lead-to-contact conversion | |
| `revops.routing` | Routing | Territory/threshold rules with reasoning output |
| `revops.tam` | TAM mapping + account scoring | Absorbs "Persona Classification + GTM Plays" (persona classification and play assignment are its scoring outputs) |
| `revops.etl` | Reporting + reverse ETL | Systems integration lands here |
| `revops.remediation` ★ | Data remediation | The Layer-7 workstream; often the first billable track |

### platform.* (always-on only — the renewal engine)

| ID | Module | Notes |
|---|---|---|
| `platform.signals` ★ | Signal watching | Monitors buying signals → triggers plays in enabled modules |
| `platform.quality` ★ | Continuous quality monitoring | Data contracts, drift alerts |
| `platform.digests` ★ | Weekly digests | Delivery-channel outputs per manifest |
| `platform.learning` ★ | Learning loops | Layer 8 speeds 1–3 |
| `platform.metrics` ★ | Metrics reporting | Baseline → delta reports; the renewal artifact |

★ = in the always-on set (PLAN.md §4).

**Onboarding is not a module.** Taxonomy B/D's "Track 0 — Kickoff & Activation" maps to Sartre's Onboarding Week motion (Data Audit → Brain Builder → manifest → connectors → first module live), which precedes module activation.

---

## 3. Source → canonical mapping

| Source item | Canonical module(s) |
|---|---|
| A1 / B-E / C4: Outbound Automation | `sales.outbound` (+ `marketing.copy-factory` for copy) |
| A2 / B-D / C5 / D-B / D-D: Inbound Lead Automation / Enrichment & Routing / Aggregation & De-Anonymization | `marketing.inbound` (+ `marketing.deanon`) |
| A3 / B-A / C2 / D-A: CRM Enrichment (+ Data Foundation / Prioritization) | `revops.enrichment` + `revops.dedup` (+ `revops.remediation` when data health is the scope) |
| A4: GTM Ops Automation | `sales.rep-workflows` + `sales.copilot-briefs` (the catch-all playbook's use cases split across these) |
| B-B / C1: TAM Mapping & Account Scoring | `revops.tam` |
| B-C: Signal Infrastructure & Intelligence Layer | `platform.signals` (+ `sales.outbound` signal-triggered mode) |
| B-F / C8: Systems Integration & Reverse ETL | `revops.etl` |
| B-G / C6: Rep Workflow & Daily Prep | `sales.rep-workflows` |
| C3: Persona Classification + GTM Plays | `revops.tam` (classification/scoring) + `sales.outbound` (play execution) |
| C7: Event + Partner Outreach | `marketing.events` |
| D-C: Account Intelligence & Pre-Meeting Automation | `sales.copilot-briefs` |
| B-0 / D-0: Kickoff & Activation | Onboarding Week (not a module) |

Every item in every source taxonomy is covered; no canonical module exists without a source ancestor except `sales.abm`, `sales.reactivation`, `sales.takeout`, `marketing.ads-sync` (from PLAN.md §4's fuller GTM-stack scope) and the `platform.*` set (the always-on retention engine, new in Sartre).

---

## 4. Open questions for sign-off

1. Does Services agree track letters stay free-form per SOW, with module IDs underneath? (Matches actual SOW practice today.)
2. Any modules to cut from v1 scope? (`marketing.ads-sync` and `sales.takeout` have the thinnest source evidence.)
3. Related flag, not blocking: cxt_hub carries **two conflicting ICPs** — `sales/01_icp.md` ($100M+ revenue) vs `team/sales/revenue-resources/kiln-icp.md` (May 2026, $10M–$500M ARR, tiered). Sartre imports both and marks the newer one current, but The Kiln should reconcile.
