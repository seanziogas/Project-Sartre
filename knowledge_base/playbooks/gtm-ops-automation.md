> **Provenance:** imported 2026-07-09 from cxt_hub read-only reference copy (`playbooks/gtm_ops_automation.md`). Maintained in Sartre from now on; upstream is never edited from this repo.

# GTM Ops Automation Playbook

## Purpose

GTM Ops Automation is The Kiln's catch-all use case for any go-to-market automation that doesn't fit cleanly into outbound, inbound, or CRM enrichment. These are bespoke workflow builds that solve specific operational pain points — often the "last mile" friction that slows reps, managers, or ops teams down every day.

This playbook is intentionally less prescriptive than the others. By definition, GTM Ops engagements are custom. The frameworks here are principles and patterns, not step-by-step instructions.

---

## What Falls Into This Category

GTM Ops Automation includes anything that automates or improves how the client's revenue team operates day-to-day. Examples:

| Use Case | What It Does |
|---|---|
| Pre-call research co-pilot | Automatically pulls relevant intel on an account before a meeting (recent news, job changes, open tasks, CRM history) and delivers a brief to the rep |
| Post-call CRM auto-update | After a Fathom/Gong call recording, extracts key fields (next steps, MEDDIC fields, sentiment) and writes them into the CRM automatically |
| SDR-to-AE handoff automation | When an SDR books a meeting, automatically creates the AE's prep brief, updates CRM stage, notifies AE in Slack, and schedules follow-up tasks |
| Deal desk automation | Automatically routes expansion or renewal deals to the right approvers based on deal size, region, or product |
| Churn risk alerting | Monitors product usage, CRM activity, and communication patterns to flag at-risk accounts to CS or sales |
| Rep performance dashboards | Consolidates activity and pipeline data from CRM into a rep-facing or manager-facing view |
| Content personalization | Generates custom case studies, one-pagers, or proposals based on prospect data pulled from CRM and Clay |
| Meeting prep workflows | Aggregates LinkedIn, CRM, and news data ahead of a meeting and delivers a structured briefing doc |

---

## How to Approach a GTM Ops Engagement

Because these builds are bespoke, the quality of discovery is even more critical than in other use cases. The GTME cannot default to a template — they need to deeply understand the client's specific pain before designing anything.

### Step 1: Define the Pain Precisely

Before scoping any build, the GTME must answer:
- What is the exact task or workflow that's creating friction?
- Who does it? How often? How long does it take?
- What information do they need to complete it, and where does that information live today?
- What happens when it's done poorly or not at all?

A vague pain ("our reps don't have enough context before calls") leads to a vague build. A specific pain ("our AEs spend 20 minutes before every discovery call manually pulling LinkedIn profiles, CRM history, and open tasks from three different tools") leads to a specific, high-value build.

### Step 2: Map the Current State

Document the current workflow:
- What triggers it?
- What data sources are involved?
- What tools are touched?
- What does the output look like today (usually: a manually assembled doc, a Slack message, nothing)?
- Who receives it and how do they use it?

### Step 3: Design the Future State

Define the automated workflow:
- What triggers the automation? (a meeting booked, a call ended, a stage change in the CRM, a button press, a scheduled job)
- What data does it aggregate and from where?
- What logic does it apply? (AI enrichment, field mapping, conditional routing)
- What does the output look like? (a Slack message, a CRM update, a Notion doc, a Google Doc, an email)
- Who receives it and when?

Validate the design with the end user before building. A GTME who designs a beautiful system for the VP of Sales and then discovers the AEs won't use it has wasted weeks of build time.

### Step 4: Build, QA, and Adopt

Same principles as the standard track delivery process (see `delivery/03_track_delivery_process.md`):
- Brief the TOS clearly with context on the pain and the design
- GTME QAs against client context, not just technical function
- Ship with a demo; confirm adoption in the week following

---

## Common Toolstack for GTM Ops Builds

| Component | Common Tools |
|---|---|
| Trigger layer | Zapier, N8N, webhooks, Clay, CRM workflow triggers, Fathom webhooks |
| Data aggregation | Clay, N8N, direct API calls |
| AI enrichment / generation | Claude, GPT models (via Clay or API) |
| Output delivery | Slack (via webhook or N8N), CRM field updates, Notion, Google Docs, email |
| Scheduling | N8N, Zapier, Prefect (for complex pipelines) |

---

## Design Principles for GTM Ops Builds

**Build where the rep already works.** If a rep uses Slack all day, deliver the output in Slack — not a tool they have to open separately. The best automation is invisible: it just makes what the rep already does easier.

**Start simple, then add complexity.** It's tempting to build the full vision in one go. Don't. Build the simplest version that solves the core problem, ship it, confirm adoption, and then layer on complexity based on real feedback.

**Automate the research, not the judgment.** GTM Ops automation should give humans better inputs — not replace human judgment. A pre-call brief should surface information; the rep decides what to do with it. A churn risk alert should flag the account; the CSM decides how to respond.

**Document the trigger logic.** GTM Ops builds often have complex trigger conditions. Document them clearly — what causes the automation to fire, what suppresses it, what edge cases are handled and how. This matters enormously for maintenance.

**Plan for failure modes.** What happens if the CRM data is missing? If the API call fails? If the meeting gets cancelled? Build graceful failure handling — a missing field should produce a clear fallback, not a broken output.

---

## Scoping GTM Ops Engagements

Because every engagement is different, scoping is more important here than anywhere else. The GTME should:

1. Define the exact workflow being automated (not "pre-call research" — "a Slack message delivered to the AE's DM 1 hour before any discovery call, containing their prospect's LinkedIn summary, last 3 CRM activities, open tasks, and latest company news")
2. Identify every data source and confirm access before committing to a build
3. Define acceptance criteria in measurable terms ("the AE receives the brief 60 minutes before 95%+ of qualifying meetings, with no manual input required")
4. Identify what's out of scope explicitly

---

## Notes

> 🚧 *Add example builds with architecture diagrams, N8N workflow exports, and Clay table templates from past GTM Ops engagements. Document trigger-specific patterns (Fathom webhook → CRM update, CRM stage change → Slack alert, etc.).*
