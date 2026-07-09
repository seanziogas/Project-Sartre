> **Provenance:** imported 2026-07-09 from cxt_hub read-only reference copy (`playbooks/outbound_automation.md`). Maintained in Sartre from now on; upstream is never edited from this repo.

# Outbound Automation Playbook

## Purpose

This playbook is a reference guide for GTM Engineers running an outbound automation engagement. It covers how The Kiln approaches outbound system design, the typical build components, and the principles that separate a high-performing outbound motion from a spray-and-pray one.

---

## What Outbound Automation Means at The Kiln

Outbound automation at The Kiln is not about blasting leads. It's about building a system that surfaces the right prospects, enriches them with meaningful context, crafts relevant messaging, and delivers it through the right channel at the right time — with minimal manual effort from the client's reps.

Scope varies significantly by client. Two key factors determine the scope:

1. **TAM size** — A company selling to 500 enterprise accounts needs different automation than one with a TAM of 50,000 mid-market companies.
2. **Automation appetite** — Some clients want fully automated sequences; others want the machine to surface and write, but reps to review and send. Always calibrate to the client's comfort level.

---

## Four Core Outbound Automation Patterns

### Pattern 1: Fully Automated End-to-End
**What it is:** Lead sourcing, enrichment, personalized messaging, and sequence enrollment — all automated, no rep involvement.
**Best for:** High-volume TAMs, simple ICP, sequence-based email motion.
**Risks:** Quality control is harder at scale. Must have strong ICP filters and message quality checks.

### Pattern 2: Research-Automated, Rep-Sends
**What it is:** Clay surfaces and enriches leads, writes a personalized first line or full draft — rep reviews and approves before sending.
**Best for:** Enterprise or high-ACV deals where rep judgment matters; clients with "we don't want to feel spammy" concerns.
**Risks:** Adoption risk — reps may not review efficiently. Build for minimum friction.

### Pattern 3: Signal-Triggered Outbound
**What it is:** A specific signal (job change, LinkedIn post, funding round, tech install, product intent) triggers automated enrichment and enrollment.
**Best for:** Companies with strong signal data; high-ACV deals where timing is everything.
**Risks:** Signal data quality and timeliness matters enormously. Test signal sources before scaling.

### Pattern 4: List-Based Campaign
**What it is:** Client provides a target account or contact list; The Kiln enriches, cleans, and loads it into a sequence.
**Best for:** Event follow-ups, ABM motions, specific verticals or segments.
**Risks:** List quality is the GTME's responsibility to assess before committing to a timeline. Bad lists = bad results.

---

## Standard Build Components

Most outbound automation engagements include some combination of:

| Component | Tool(s) | Notes |
|---|---|---|
| Lead sourcing | Clay (data providers waterfall), Apollo, LinkedIn | Define ICP filters before sourcing; don't source > enrich > discover the ICP is wrong |
| Enrichment | Clay (waterfall methodology across 50+ providers) | Prioritize fields that drive personalization and routing; not all fields need enrichment |
| Personalization | Clay + Claude/GPT | First lines, value props, or full message drafts; always QA output quality at scale |
| Sequence enrollment | Instantly, Smartlead, Outreach, SalesLoft, Apollo | Know the client's sequencer before building; don't assume |
| CRM sync | HubSpot, Salesforce, Attio | Confirm field mappings before building; syncing to wrong fields breaks reporting |
| Deduplication / existing contact check | Clay + CRM integration | Don't enroll someone who's already a customer, open opp, or recent contact |

---

## Discovery Questions (Phase 1)

Before designing the system, the GTME must understand:

**ICP and targeting:**
- Who exactly is the ICP? Title, company size, industry, geography, tech stack?
- How large is the TAM? Are there specific named accounts or is it persona-based?
- What's the buying committee? Who's the target, who's the influencer, who signs the check?

**Current motion:**
- What outbound are they doing today (if anything)?
- What's working? What's not?
- What sequencer do they use? How do sequences currently get enrolled?

**Automation appetite:**
- Do they want fully automated or rep-reviewed?
- How do they feel about AI-written messaging?
- Have they had bad experiences with automated outbound before?

**Data and toolstack:**
- Do they have a Clay instance? What plan?
- What data providers are they already paying for?
- What CRM fields drive routing and reporting?

**Success criteria:**
- What does "this worked" look like in 90 days?
- Are they measuring replies, meetings booked, opportunities created?

---

## Messaging Principles

The Kiln builds for message quality, not message volume. Every outbound system should produce messages that:

1. **Are specific to the recipient.** Generic messages are skipped. Personalization must be meaningful — not just inserting {first_name} and {company_name}.

2. **Lead with relevance, not product.** The first message is about the prospect's problem, not The Kiln's (or the client's) solution. Why should they care right now?

3. **Are short.** Cold outbound messages should be under 100 words in the first line. Three sentences is plenty. Don't bury the hook.

4. **Have a low-friction CTA.** Don't ask for a 30-minute demo in the first message. Ask a question. Share something relevant. Make the reply easy.

5. **Can pass the "did a human write this?" test.** AI-generated messages should be QA'd for naturalness. If a message sounds like it was written by a bot, it'll be treated like one.

---

## QA Standards

Before any campaign goes live:

- [ ] ICP filter logic reviewed — no obvious mismatches in sourced leads
- [ ] Enrichment accuracy spot-checked — pull 10–20 records manually and verify data accuracy
- [ ] Deduplication check in place — existing customers, open opps, and recent contacts excluded
- [ ] Message quality reviewed — read 20–30 generated messages end-to-end; flag AI artifacts
- [ ] Sequencer enrollment logic tested — send a test enrollment through a sandbox or test contact
- [ ] CRM sync tested — confirm data lands in the right fields and doesn't overwrite anything
- [ ] Unsubscribe/compliance logic in place — confirm opt-out handling is correct for the client's region

---

## Common Failure Modes

| Failure | Root Cause | Fix |
|---|---|---|
| Low reply rates despite high volume | ICP too broad; message not relevant | Tighten ICP; rewrite message; reduce volume, improve targeting |
| Enrichment fields empty at scale | Wrong data providers for this ICP | Test waterfall coverage before building at scale |
| AI messages sound robotic | Prompts not calibrated; no QA | Improve prompt with examples; QA 20+ messages before launch |
| CRM sync causes data issues | Field mappings not validated with RevOps | Always confirm CRM field mappings with the admin before writing |
| Reps aren't using the system | Rep adoption not addressed | Build for minimum friction; involve reps in testing; show them a winning example |

---

## Notes

> 🚧 *Add specific Clay table structures, enrichment waterfall configurations, and prompt templates used across past engagements. These should live in shared Clay workbooks and be referenced here.*
