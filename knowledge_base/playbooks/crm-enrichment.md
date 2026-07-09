> **Provenance:** imported 2026-07-09 from cxt_hub read-only reference copy (`playbooks/crm_enrichment.md`). Maintained in Sartre from now on; upstream is never edited from this repo.

# CRM Enrichment Playbook

## Purpose

This playbook is a reference guide for GTM Engineers leading a CRM cleanup or enrichment project. It provides the high-level framework, internal principles, and operational structure for running these projects with speed, clarity, and consistency across clients.

This is not a step-by-step execution manual. It outlines how we think about CRM projects, why they matter, what outcomes they must achieve, and the sequencing GTMEs should follow to deliver consistently excellent work.

**Phases:**
1. Discovery & Stakeholder Alignment
2. Project Planning & Scoping
3. Execution (Backup → Standardize → Pre-Enrich → Deduplicate → Enrich → Maintain)
4. QA, Documentation & Handoff

---

## High-Level Overview

### Why This Project Exists

CRM cleanup and enrichment projects exist for one core reason: **to restore trust in the CRM so it becomes usable for forecasting, routing, reporting, and daily IC operations.** A CRM with bad data slows down the entire go-to-market function — from outbound to attribution to leadership reporting.

Clients come to us because:
- ICs don't trust CRM data because it's inaccurate
- CRM data is incomplete — they need more relevant data
- Forecasting and/or reporting is inaccurate
- Automations and attribution break because data quality is weak

### Strategic Goals

Every CRM enrichment project has three strategic goals:
- Build a CRM the client can trust for forecasting, reporting, and operational decision-making
- Improve IC productivity by equipping them with accurate, relevant, and reliable data
- Create a scalable, maintainable data foundation for outbound, routing, automation, scoring, and RevOps workflows

### How to Communicate Value to the Client

Anchor your explanation around **IC productivity and efficiency**. A CRM is the **armory** that equips ICs with the information they need to effectively run outbound, prioritize leads, and hold relevant conversations.

BDRs and AEs need accurate, relevant, and timely data to consistently have meaningful conversations with prospects. If the CRM is filled with poor or missing data, ICs operate blind. This is the language Sales and Marketing leadership responds to.

If they mention specific pains or goals outside of this, focus on those outcomes too when communicating value.

### Expected Outcomes

Every project should deliver:
- A CRM the client trusts and uses consistently
- Higher fill rates on the fields that matter
- A clear set of rules for standardization, deduplication, enrichment, and maintenance
- Accurate, usable data for ICs (BDRs, SDRs, AEs)
- A stronger reporting and forecasting foundation
- Documented workflows the client can reference going forward

This is what "done" means.

### What We Do Not Touch

This is a hard boundary. CRM enrichment projects do not include:
- Changing lifecycle stages
- Redesigning lead status frameworks
- Modifying custom objects
- Re-architecting attribution models
- Rebuilding the CRM schema

Those are RevOps / CRM architecture initiatives and sit outside our scope. Communicate this clearly up front:

> *"We're here to clean and strengthen what already exists, not to rewire the CRM. That type of work is for HubSpot/Salesforce experts and is outside our area of expertise."*

This framing reduces client anxiety and sets clear boundaries. Do not let scope creep into these areas.

---

## Phase 1: Discovery & Stakeholder Alignment

No technical cleanup should begin until this phase is complete. Your job here is to deeply understand:
- How the CRM is used today
- Who uses it and for what
- What is broken or missing
- What the end state should look like
- What constraints and risks exist

**If the project is already scoped:** Read through this phase to identify what additional discovery is necessary and what can be skipped. When unsure, loop in your MD.

### Who We Need to Speak To

We must talk to all of the following, or we risk building the wrong CRM or breaking important workflows:

- **Sales Leadership** — forecasting, reporting, pipeline visibility
- **RevOps Leadership** — data model, reporting dependencies, automation logic
- **CRM Admin** — system constraints, validation rules, integration touchpoints
- **ICs (BDRs, SDRs, AEs across segments)** — frontline workflow pain points; these are the primary beneficiaries of the cleanup
- **Marketing** (if applicable) — routing, attribution, lead status logic

If you skip any persona, you lose perspective and risk missing key requirements. The most important people to talk with are the ICs — we cannot start a CRM enrichment project without first talking with them. They will see 80–95% of the benefit.

If the client has distinct IC types (e.g., mid-market and enterprise SDRs, SMB and enterprise AEs), talk with one of each type. Ask the main stakeholder to introduce you to **top performers** in each segment.

### How to Get on the Phone With Them

Start with the main stakeholder who initiated the project:

> *"To make sure we don't break anything important and that we focus on improvements that actually impact your team day-to-day, who on your Sales, RevOps, and IC teams uses the CRM regularly? Can you introduce us so we can understand their workflows before cleanup begins?"*

**If they say yes:** Take the intros immediately and schedule the calls.

**If they say no:**
> *"Totally fine — in that case, can you walk us through how Sales Leadership, RevOps, and ICs use the CRM today, what fields matter most to them, and what their biggest pain points are?"*

### How to Run the Discovery Calls

The first and most important question for everyone except the CRM Admin is:

> *"How do you use the CRM today? Can you walk me through your daily, weekly, and monthly workflow — and if possible, share your screen and show me exactly how you use it?"*

This question surfaces how they actually interact with the CRM and what data they rely on. Then tailor your follow-up by persona.

---

**Sales Leadership** *(focus: forecasting accuracy, pipeline visibility, rep accountability)*
- "Which reports do you rely on, and which ones do you not trust?"
- "What data gaps hurt forecasting or pipeline reviews?"
- "What do you believe ICs will say their biggest frustrations are?"
- "What information do reps always wish they had before reaching out?"

---

**RevOps Leadership** *(focus: backend structure, reporting/dashboarding, automations)*
- "Which fields drive downstream reporting, routing, or attribution?"
- "Where are the biggest inconsistencies today?"
- "Which workflows or automations are off-limits for changes?"
- "What cleanup efforts in the past caused problems?"

---

**CRM Admin** *(focus: validation rules, integrations, field-level risks)*
- "What parts of the CRM are most fragile today?"
- "What automations should we avoid touching?"
- "Which fields have downstream dependencies?"
- "What limitations exist with merging or enrichment?"
- "What do you want to make sure we do NOT do during cleanup?"

---

**ICs (BDRs, SDRs, AEs)** *(focus: data accuracy, coverage, speed)*
- "What slows you down the most?"
- "What fields do you ignore because they're unreliable?"
- "What data points matter most to you for outbound?"
- "What information do you wish were always accurate?"
- "What information do you not have but wish you did before a discovery call?"

---

### What This Phase Gives You

By the end of Phase 1, you should have a clear picture of:
- Each stakeholder's specific issues with the CRM
- Which improvements would drive the most value for the team
- Hard constraints — what you should not touch or risk breaking

This is the foundation for the project plan. If this information is missing, you're guessing. Go back and fill the gaps.

---

## Phase 2: Project Planning & Scoping

Once discovery is complete, Phase 2 turns what you learned into a clear, scoped project plan and a simple narrative for the client.

**Two jobs:**
1. **Internally:** Decide what we're doing, in what order, and where we will not spend time
2. **Externally:** Communicate a plan the client can understand and approve, framed around outcomes, timeline, costs, and risks

The output of this phase is a written plan in Notion (using the project plan template) that you can walk through with the client and use as your internal blueprint.

### Inputs You Should Have By Now

- Notes from every stakeholder (Sales Leadership, RevOps, CRM Admin, ICs)
- A working understanding of the current CRM structure (key objects, fields, main automations)
- A clear picture of pain points and what "good" looks like to each stakeholder
- Documented constraints — fields, workflows, and areas that are sensitive or off-limits

If any of this is missing, go back to Phase 1.

### Define the Objectives

Keep this tight — 2 to 4 bullets max. Pick the ones that match what you heard in discovery.

Examples:
- "Clean and dedupe active Accounts and Contacts used by Sales today."
- "Standardize and enrich key fields needed for outbound and routing (industry, size, persona, title, email, LinkedIn URL)."
- "Improve reporting and forecasting by fixing lifecycle, owner, and stage consistency for active pipeline."

Add a catch-all at the end:
> *"All other CRM changes or RevOps initiatives are out of scope for this project."*

### Define the Data Scope

Decide what data you will actually touch. This prevents the "let's fix the entire CRM" trap.

Clarify which **objects** are in scope (Accounts, Contacts, Leads, Opportunities, relevant custom objects) and which **records** are in scope:
- e.g., "Accounts with activity or open Opportunities in the last 12–18 months"
- e.g., "Contacts owned by SDR/AE teams in current territories"
- e.g., "Leads created in the last 24 months"

State explicitly what is not in scope:
> *"Historical dormant records older than X years are excluded from this pass."*

### Prioritize Fields by Use Case

You're not cleaning every field — you're prioritizing what drives the client's key use cases.

**Step 1:** List the primary use cases from Phase 1. Common examples:
- Outbound targeting
- Territory / lead routing
- AE account planning
- Leadership reporting / forecasting

**Step 2:** For each use case, identify the critical fields per object. Example:
- Outbound: industry, company size, persona, seniority, title, email, LinkedIn URL
- Routing: owner, territory, region, lifecycle stage, lead status, lead source
- Reporting: opp stage, close date, amount, primary contact, pipeline category

This becomes your **field priority matrix** — these fields get the most attention in cleanup, standardization, and enrichment. Everything else is secondary.

### Identify Do-Not-Touch Areas and Risks

From your RevOps and CRM Admin conversations, explicitly document:

- **Sensitive fields:** lifecycle stage, lead status, attribution fields, owner fields, anything driving key automations
- **Workflows/automations that must not break:** lead assignment, MQL/SQL triggers, product/billing integrations, key third-party sync logic

Write these down explicitly. If you're unsure whether something belongs on this list, escalate to your MD.

### Write the Plan in Notion

Turn everything above into a single Notion page using the CRM Enrichment Project Plan template. The plan should answer for the client:
- **Outcomes:** What will be different about the CRM when we're done?
- **Timeline:** Rough phase durations (e.g., Weeks 1–2, Weeks 2–4, etc.)
- **Costs:** Rough effort (hours, team involvement) and Clay/enrichment credit usage
- **Risks & Constraints:** What we're not touching and what could affect success (slow approvals, unclear ownership, system limitations)

Internally, also document the **sequence of work:**
1. Data backup & snapshot
2. Standardization
3. Pre-enrichment
4. Deduplication
5. Enrichment
6. Maintenance setup

### Align With Your MD Before Presenting

Before sharing the plan with the client:
- Sanity check it with your MD
- Confirm it's achievable within the engagement duration, allocated hours/budget, and available Clay credits
- Flag areas where client expectations are unrealistic, scope is too broad for the timeline, or there are technical risks

Adjust the plan now, not mid-project.

---

## Phase 3: Execution

Phase 3 only begins after the project is fully scoped and the client and your team are aligned on goals, timelines, and risks.

**The order of operations is strict:**
1. Data Backup & Snapshot
2. Standardize
3. Pre-Enrich
4. Deduplicate
5. Enrich
6. Maintain

The details vary by client. The order does not.

### 3.0 — Data Backup & Snapshot (Required)

**Backup:** Before touching anything in the CRM, have the client run a full backup. This is non-negotiable.
- HubSpot: Settings → Data Management → Backup & Restore
- Salesforce: Native Data Export Service

The client owns and runs the backup. We do not skip this even if they push back.

**Baseline Metrics Snapshot:** Before making changes, capture a snapshot of current data health. This creates "square 1" — the before state — so you can demonstrate improvement after.

Examples of metrics to snapshot (based on project goals):
- % of accounts with an accurate, standardized domain
- % of contacts with a valid email
- % of key fields (industry, persona, title) populated vs. empty

> *"Before the project, 60% of accounts had a domain, and only ~40% of those were clean and normalized. After this phase, we'll be able to show how many accounts now have standardized domains and how much duplication we removed."*

Capture these same metrics again after Phase 3 completes to demonstrate the delta.

### 3.1 — Standardize

Standardization is **client-defined**, not imposed by us. The goal is to agree on what "correct" looks like for each key field before any enrichment or deduplication begins.

**Identify the right client stakeholder** by asking:
> *"When it comes to how CRM fields should be standardized, who on your team is most opinionated about that — RevOps or the CRM Admin?"*

**Run a Standardization Alignment Conversation** covering:
- Which fields matter most to standardize
- Whether standards already exist internally
- Preferred formats and naming conventions
- Reporting or automation constraints on specific fields
- Exceptions to be aware of

You can suggest common patterns, but always frame them as options — the client defines the standard.

**Document everything** in the Standardization Rules tab of the CRM Enrichment Tracker Google Sheet: field name, object, approved standardized format.

**Execute in Clay:**
1. Pull relevant records (accounts and/or contacts) into Clay via the native HubSpot or Salesforce integration
2. Use formulas to build logic reflecting each standardization rule
3. Use AI (not Claygent) for any logic that can't be handled by formula
4. Track standardization results — record how many fields were standardized by comparing the standardized output against the original (checkbox in Clay)
5. Report the numbers to the client

### 3.2 — Pre-Enrich

Pre-enrichment exists for one reason: **to make deduplication possible.** In many CRMs, key identifiers are missing. You cannot reliably deduplicate without them.

**Typical pre-enrichment targets:**
- Account domain
- Company LinkedIn URL
- Contact LinkedIn URL
- Contact email (when missing)

This is a minimal enrichment pass, not full enrichment. The goal is to raise identifier coverage high enough that deduplication logic works reliably — for example, moving domain coverage from 60% to ~90%.

### 3.3 — Deduplicate

We identify and **flag** duplicates. We do not delete or merge records.

Clay is used to detect duplicates and recommend primaries. Destructive actions (merging, deleting) are owned by RevOps or the CRM Admin inside the CRM.

**What we deliver:**
- Duplicate Account clusters
- Duplicate Contact clusters
- Flags and grouping fields (e.g., `Duplicate_Flag`, `Duplicate_Group_ID`)
- Primary record recommendations
- Notes explaining why records are considered duplicates

**Order matters:** Accounts first, Contacts second.

**Deduplication standards:**

| Object | Field | Rule |
|---|---|---|
| Accounts | Domain | Normalize: remove `www`, lowercase, strip trailing `/` or country subpaths (`example.com/us` → `example.com`) |
| Accounts | Name | Strip legal suffixes, lowercase (`Acme Inc.` → `acme`) |
| Accounts | Priority | Keep record with most populated fields |
| Accounts | Protected | Exclude records where `Do_Not_Touch = TRUE` |
| Contacts | LinkedIn URL | Exact match |
| Contacts | Email | Lowercase exact match |
| Contacts | Fuzzy (fallback) | Levenshtein distance on Name + Company when no LinkedIn or email match |

When merging, prefer the record with the most filled fields, the earliest creation date, and the most activity (when available). Validate a sample of results manually before final merge.

### 3.4 — Enrich

Once identifiers are clean and duplicates are flagged, run scoped enrichment based on the Phase 2 field priority matrix.

Enrichment should be:
- **Use-case driven** — enrich what helps ICs sell and RevOps operate, nothing more
- **Tiered** — Tier 1 (core ICP) gets full enrichment; Tier 2 gets partial; Tier 3/unqualified gets skipped
- **Validated** — spot check results before pushing back to the CRM

**Credits estimation:** Align with the client on which fields to enrich and which tools/APIs they already have keys for before estimating. Use Clay's credit estimator. Offer two estimates: conservative and full coverage. Emphasize ROI-based enrichment in client communication: "We enrich only what drives pipeline, not everything."

**Contact employment validation:** For any contact enrichment, verify the contact still works at the company listed in the CRM. Use the LinkedIn experience array to check for `is_current` experience objects and compare against the CRM company. Flag contacts as Current / Former / Unrelated, and exclude non-ICP roles (Realtor, Board Member, Advisor, part-time) from consideration.

### 3.5 — Maintain

Maintain is what prevents the CRM from decaying again. The goal is to make cleanliness and enrichment **ongoing and automated**, not a one-time event.

Common patterns:
- Using Clay as a layer between inbound lead sources and the CRM, so new data is standardized, enriched, and deduplicated before it ever enters the system
- Scheduled refresh workflows (weekly / monthly / quarterly) to update key enrichment fields, flag new duplicates, and monitor data completeness
- Clear ownership documented: what Clay automates, what RevOps reviews, what ICs are responsible for maintaining

This phase is critical. Without it, the CRM will drift back into disrepair over time.

---

## Phase 4: QA, Documentation & Handoff

*[This phase is currently being defined — below is the working framework.]*

### QA

Before closing out the project:
- **Record count validation:** Compare record counts pre and post cleanup to confirm no data loss
- **Random audit:** Pull a random sample of 10–20 records and manually verify they were processed correctly. Ideally done by a second operator, not the person who ran the enrichment.
- **Metric delta report:** Pull the same baseline metrics captured at the start of Phase 3 and compare. Document the before/after for every key metric.
- **Flag review:** Confirm all flagged duplicates have been reviewed and resolved (or handed off with clear next steps for the client)

### Documentation

Save all working Clay tables and versioned exports. Document the project in Notion under the client's workspace, covering:
- Project summary (scope, objectives, what was done)
- Key before/after stats
- Final outputs (what was enriched, what was standardized, what was flagged)
- Standardization rules used (link to the tracker)
- Do-not-touch areas and any risks encountered
- Maintenance setup — what's automated, what requires ongoing client action

### Handoff

The goal of the handoff is to make sure the client can operate the outputs independently and understands what was built.

*[Further detail on handoff format and client deliverables to be added — see open questions below.]*

---

## Appendix: Technical Standards

### Contact Employment Validation

**Objective:** Verify that contacts still work at the company listed in the CRM.

**Logic:**
1. Input: LinkedIn experience array for each contact
2. Identify `is_current` experience objects
3. Check if company name/domain matches the CRM company
4. If not current, check if the company exists in past experiences
5. If neither current nor past: flag as invalid

**Output fields:**
- `is_current_contact` (boolean)
- `employment_status`: Current / Former / Unrelated
- `confidence`: Low / Medium / High

**Edge cases to handle:** multi-current roles, fractional roles, advisors, part-time jobs — filter out non-ICP roles.

**Clay implementation:** Use the Filter Array of Objects function to isolate current experiences. Compare domain from CRM with `company_url` or `company_name` in current experience. Add prompt to handle ambiguous cases with reasoning.

### CRM Deletion Constraints: Mark-Don't-Delete

Never delete records directly. Instead:
1. Create a `Needs_Review` or `Duplicate_Flag` field
2. Flagging logic: if account duplicates another, mark `Duplicate_Flag = TRUE`; if contact is invalid, mark `Inactive = TRUE`
3. Generate lists by flag and hand off to client for review and action
4. Build Clay automation to send flagged records to the CRM with tag `Kiln_Cleanup_Review`
5. Schedule monthly sync for ongoing hygiene
