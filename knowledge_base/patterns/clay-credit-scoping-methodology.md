> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/clay-credit-scoping-methodology.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-03-13
source: internal-meeting-extraction
tags: [clay, pricing, enrichment, scoping]
related_concepts:
  - "[[crm-bulk-enrichment-methodology]]"
  - "[[sow-scoping-multi-stream-engagements]]"
  - "[[clay-pricing-strategy-2026-03]]"
---

# Clay Credit Scoping Methodology

A framework for calculating Clay enrichment costs, timeline, and plan requirements under Clay's dual-credit pricing model (action credits + data credits, introduced March 11, 2026).

## When to Use

- Scoping any new Clay project or enrichment workflow
- Client asks "how much will this cost?" for Clay work
- Evaluating whether Clay is the right tool vs. alternatives (e.g., direct API enrichment)
- Auditing existing Clay tables for credit efficiency
- Advising clients on plan selection or plan migration

## Core Concepts

### Dual Credit Model

Clay charges two independent credit types that both constrain throughput:

1. **Action credits** — Consumed by platform orchestration (1 action per record per operation): enrichments, AI tasks, HTTP API calls, CRM syncs, email sends, exports. **Actions do NOT roll over** — they reset every billing cycle.
2. **Data credits** — Consumed by enrichment providers (variable cost per provider). 50-90% cheaper than pre-March 2026. Roll over up to 2x monthly allotment on monthly plans; 15% on annual plans.

**Key insight:** A workflow's true cost is `max(action_credit_cost, data_credit_cost)` — whichever runs out first is your bottleneck. In most cases, **actions are the binding constraint** because they are fixed per plan tier and do not roll over.

### What Costs Actions vs. What's Free

**Costs 1 action per record:**
- Running enrichments (any provider, including when using your own API keys)
- AI research and AI model runs
- Signals activation
- CRM syncs and email sends
- HTTP API calls
- Ad audience exports
- Data warehouse syncs
- Adding leads to sequencer campaigns

**Free (no actions):**
- Sourcing/importing lists (e.g., Find People returning 100 contacts = 0 actions)
- CRM and data warehouse imports
- Webhook imports
- Clay formulas, filters, manual data entry
- Sculptor
- Audience creation (only export costs actions)

**BYOK note:** Bringing your own API keys eliminates data credit costs but still consumes 1 action per enrichment. Factor this into scoping for BYOK-heavy workflows.

## Per-Enrichment Cost Reference

Each fully enriched record typically costs **6-20 data credits** depending on enrichments selected.

| Enrichment Type | Approximate Data Credits | Notes |
|----------------|------------------------|-------|
| LinkedIn profile | ~0.5 | Per profile |
| Work email (find) | ~0.5 | ~90% success rate reported |
| Basic contact (name, email, title, company) | ~14 | Old pricing; new costs ~50% cheaper |
| Full contact (basic + phone + social) | ~34 | Old pricing; new costs ~50% cheaper |
| Company enrichment (firmographics + technographics) | ~41 | Old pricing; new costs ~50% cheaper |
| Complete profile (contact + company) | ~75 | Old pricing; new costs ~50% cheaper |

**Important:** Failed lookups are now refunded. Clay credits back data credits when a provider returns no data or invalid data. This is a significant change from the old model where all attempts consumed credits.

## Scoping Framework

### Step 1: Inventory the Enrichments

For each enrichment in the workflow, document:
- Provider/enrichment type (e.g., Find Work Email, Enrich Company, HTTP API call)
- Data credit cost per row (check Clay's pricing calculator for current rates)
- Action credit cost per row (1 action per operation, always)
- Whether you're using Clay's marketplace or BYOK (BYOK = 0 data credits, but still 1 action)

### Step 2: Calculate Total Credit Consumption

```
Total data credits = Σ (rows × data_credit_cost_per_row) for each enrichment
Total action credits = Σ (rows × 1) for each enrichment step + exports + syncs
```

**Example:** Enriching 10,000 contacts with email find + company enrichment + CRM sync:
- Actions: 10,000 (email) + 10,000 (company) + 10,000 (CRM sync) = 30,000 actions
- Data credits: 10,000 × ~0.5 (email) + 10,000 × ~20 (company) = ~205,000 data credits
- On Growth plan (40K actions, 6K data credits/mo): Actions fit in 1 month, but data credits need ~34 months at base tier or significant top-ups

### Step 3: Estimate Output Quality

Not all rows will return validated data. Apply realistic validation ranges:
- **Work email validation:** 30-70% of enriched rows will return verified emails
- **Phone validation:** 20-60% range depending on data quality and region
- **Failed lookups now refunded** — so effective data credit cost is lower than gross cost
- Present clients with a range, not a single number

### Step 4: Calculate Time-to-Completion

Two separate constraints to check:

```
Months (action-limited) = Total actions needed / Monthly action allotment
Months (data-limited) = Total data credits needed / Monthly data credit allotment
Actual months = max(action_months, data_months)
```

**Remember:** Actions reset monthly with no rollover. Data credits roll over up to 2x monthly cap. This means action-constrained projects can't be accelerated by banking, but data-credit-constrained projects can benefit from a month of accumulation.

### Step 5: Frequency/Cadence Factor

Some workflows run on recurring schedules (quarterly re-enrichment, monthly list updates). Calculate annual cost across both credit types:

```
Annual action cost = Single run actions × Runs per year (must fit within monthly cap each time)
Annual data credit cost = Single run data credits × Runs per year
```

**Warning:** Recurring workflows consume actions every run with no rollover. A quarterly enrichment of 30K records using 3 enrichment steps = 90K actions per run. Growth plan only has 40K/month — this requires Enterprise or spreading runs across 3+ months.

## Plan Selection Guide

| Plan | Monthly Cost | Data Credits | Actions | Best For |
|------|-------------|-------------|---------|----------|
| Launch | $185 | 2,500-10,000 | 15,000 | Light enrichment, testing, early-stage startups |
| Growth | $495-~$2,000 | 6,000-100,000 | **40,000 (fixed)** | Standard GTM workflows, CRM sync, API integrations |
| Enterprise | Custom (~$30K+/yr) | 100,000+ | 200,000+ | High-volume, compliance-heavy, multi-team |

**Key:** Growth plan data credits scale with price, but **actions are fixed at 40K** regardless of tier. This is the most common misunderstanding.

**Grandfathered Pro plan clients:** Recommend staying on current plan regardless of above matrix. Old pricing ($800/50K credits, unlimited actions) is significantly more favorable. They have until April 10, 2026 to switch between legacy plans — after that, legacy-to-legacy changes are locked.

## Workflow Efficiency Principles

1. **Minimize action credit burn** — Every operation costs 1 action per record. Chain enrichments efficiently; avoid unnecessary table-to-table transfers, redundant syncs, or re-enriching data that hasn't changed.
2. **Front-load free operations** — Use sourcing, imports, formulas, filters, and Sculptor (all free) to shape and filter data before triggering action-consuming enrichments. Smaller, cleaner input lists = fewer wasted actions.
3. **Batch against action cycles** — Actions reset monthly with no rollover. Plan large enrichments to fit within monthly action caps. Spread multi-month projects across billing cycles.
4. **Leverage data credit rollover** — Data credits accumulate up to 2x monthly cap. If a project needs a burst of data credits, let them accumulate for a month first.
5. **Audit before building** — Check for existing tables (especially from departed team members) that may be burning credits on stale workflows. This is critical for clients switching plans.
6. **Right-size the tool** — For simple one-off enrichments (<10K records, 1-2 data points), evaluate whether direct API calls via code are more cost-effective than Clay's monthly commitment.
7. **BYOK strategically** — Own API keys save data credits but NOT actions. Only use BYOK when data credit savings justify the complexity and you have action headroom.

## Presenting to Clients

When sharing cost estimates:
- Show ranges, not exact numbers (validation rates vary)
- Break down action credits vs. data credits separately — clients need to understand both constraints
- Highlight that failed lookups are now refunded (positive change)
- Include time-to-completion if the project spans multiple billing cycles
- Flag if the workflow has recurring runs (and the compounding annual cost)
- Factor in total cost of ownership: Clay subscription + LinkedIn Sales Navigator + email tool + CRM + potential overages
- Compare plan options with a clear recommendation and rationale
- Reference Clay's official pricing calculator (clay.com/pricing-calculator) for current per-enrichment rates
