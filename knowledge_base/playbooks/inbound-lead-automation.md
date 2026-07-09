> **Provenance:** imported 2026-07-09 from cxt_hub read-only reference copy (`playbooks/inbound_lead_automation.md`). Maintained in Sartre from now on; upstream is never edited from this repo.

# Inbound Lead Automation Playbook

## Purpose

This playbook covers how The Kiln designs and builds inbound lead automation systems — the infrastructure that takes raw lead signals from all sources, enriches them, scores them against the client's ICP, and routes them to the right rep or workflow automatically.

---

## What Inbound Lead Automation Means at The Kiln

Inbound leads are a company's warmest signal. When someone fills out a form, signs up for a trial, registers for a webinar, or engages with content, they've raised their hand. The problem most companies have is not lack of inbound — it's that their inbound processing is manual, slow, fragmented, and inconsistent.

The Kiln's inbound automation system solves this by creating a single automated layer that:
1. **Aggregates** leads from all sources into one place
2. **Enriches** each lead with firmographic and contact data
3. **Scores** leads against the client's ICP
4. **Routes** qualified leads to the right rep or sequence — and discards (or deprioritizes) what doesn't qualify

The output is a clean, prioritized, context-rich lead queue that reps can work immediately — no manual research, no CRM data entry, no guessing about fit.

---

## Common Inbound Sources

| Source | What It Produces | Typical Integration |
|---|---|---|
| Website forms (demo, contact, trial) | High-intent leads | Webhook → Clay |
| Product signups (PLG) | Usage-based intent | CRM sync or API |
| LinkedIn Lead Gen Forms | Social-intent leads | LinkedIn API or Zapier → Clay |
| Webinar / event registrations | Education-intent leads | Eventbrite, Zoom Webinar, etc. → Clay |
| Content downloads (gated) | Research-intent leads | HubSpot/Marketo form → Clay |
| Inbound email | Direct interest | Gmail/Outlook inbox monitoring |
| Chat (Drift, Intercom) | Real-time engagement leads | Webhook → Clay |

---

## Standard System Architecture

```
Lead Signal (any source)
        ↓
Clay (aggregation + enrichment + scoring)
        ↓
ICP Score Threshold
   ↓              ↓
Qualified       Not Qualified
   ↓              ↓
Route to rep   Deprioritize or discard
or sequence    (or nurture track if applicable)
   ↓
CRM (create/update contact + company)
+ Sequencer enrollment (if applicable)
+ Slack alert to rep (if applicable)
```

---

## Discovery Questions (Phase 1)

Before designing the system:

**Lead sources:**
- Where do inbound leads come from today? Which sources matter most?
- Which sources are currently not being worked at all?
- Is there a lead volume problem (too many to work) or a coverage problem (too few being followed up)?

**Current routing logic:**
- How are leads assigned to reps today? Manual, round-robin, territory-based?
- What does an "unqualified" lead look like? What should happen to it?
- Are there separate tracks for SMB vs. mid-market vs. enterprise?

**ICP and scoring:**
- What makes a lead qualified? Is there a formal ICP definition?
- What data points drive the scoring — industry, company size, title, intent, product usage?
- Is there an existing lead scoring model, or are we building one from scratch?

**CRM and toolstack:**
- What CRM are they using? What fields need to be created or populated?
- Is there an existing integration between inbound sources and the CRM?
- What sequencer should qualified leads be enrolled in?

**Success criteria:**
- Are they measuring time-to-contact, lead-to-opportunity conversion, or rep coverage rate?
- What does "this worked" look like in 90 days?

---

## ICP Scoring Framework

The scoring model should be built from the client's actual ICP definition, not generic best practices. Typical dimensions:

| Dimension | Weight (example) | Notes |
|---|---|---|
| Company size (employees or revenue) | High | Must match target segment |
| Industry / vertical | High | Exclude non-ICP verticals early |
| Title / seniority | High | Target persona vs. non-buyer |
| Geography / territory | Medium | Territory assignment logic |
| Tech stack | Medium | Tool presence signals fit (e.g., Salesforce CRM + Clay) |
| Intent signals | High | Demo request > content download > event registration |
| Funding stage | Low–Medium | Depends on client's go-to-market |

Output: a numeric score or tiered label (e.g., A / B / C / Disqualify).

Always validate the scoring model against a sample of past won deals and past churned or unqualified leads before deploying at scale.

---

## Enrichment Fields to Prioritize

Not every field needs to be enriched on every lead. Focus on what drives routing and rep productivity:

**For routing:**
- Company domain (for deduplication against existing CRM accounts)
- Employee count / revenue estimate (for segment assignment)
- Industry / vertical
- Territory / geography (for rep assignment)

**For rep productivity:**
- LinkedIn URL (contact and company)
- Verified work email
- Company LinkedIn URL
- Title and seniority
- Technology stack (if relevant to ICP)
- Recent intent signals (if available)

---

## Routing Logic Patterns

**Round-robin** — Leads distributed evenly across available reps. Simple to build, but doesn't account for territory, segment, or rep specialty.

**Territory-based** — Leads routed by geography, industry, or named account ownership. Requires clean territory mapping in the CRM.

**Segment-based** — SMB leads go to one team; enterprise leads go to another. Requires ICP scoring to determine segment reliably.

**Rep-match** — Lead matched to the rep who already owns the account (for companies with existing CRM relationships). Requires account-level deduplication.

**Hybrid** — Most real-world systems combine multiple rules. Build the simplest version first; add complexity only when simpler logic breaks down.

---

## QA Standards

Before going live:

- [ ] All source integrations tested with live or sample data
- [ ] Enrichment accuracy spot-checked on 10–20 sample leads
- [ ] ICP scoring logic validated against known examples (past won deals, obvious non-fits)
- [ ] Routing logic tested across all relevant segments and territories
- [ ] CRM sync tested — lead and contact records created correctly, no field overwrites
- [ ] Duplicate detection working — existing accounts and contacts identified
- [ ] Sequencer enrollment tested (if applicable)
- [ ] Rep notification working (Slack alert, CRM task, or email)
- [ ] "Disqualified" path confirmed — where do non-ICP leads go?

---

## Common Failure Modes

| Failure | Root Cause | Fix |
|---|---|---|
| Leads fall through the cracks | Source integrations not comprehensive | Audit all inbound channels; ensure every source feeds the system |
| ICP score doesn't match rep judgment | Scoring model built without IC input | Interview reps and RevOps during discovery; validate against real examples |
| Reps ignore routed leads | No buy-in; system doesn't match their workflow | Involve reps in design; make the output land where they already work |
| CRM duplication | Dedup logic missing or weak | Build domain-based dedup; check existing contacts and companies before creating new |
| Too many leads flagged as qualified | Scoring thresholds too loose | Tighten ICP definition; raise score threshold; add disqualifying criteria |

---

## Notes

> 🚧 *Add Clay table templates and scoring formulas used in past inbound engagements. Document webhook setup patterns for common form tools (HubSpot forms, Typeform, Webflow, etc.).*
