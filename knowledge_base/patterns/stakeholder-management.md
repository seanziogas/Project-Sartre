> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/frameworks/stakeholder-management.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: framework
date: 2026-03-08
tags: [stakeholder-management, client-relations, communication]
---

# Stakeholder Management Framework

A reusable framework for managing client relationships across all engagement phases — onboarding, active work, crisis recovery, and offboarding. Designed for GTM engineering consulting where stakeholder dynamics directly determine engagement success.

**Core belief:** Clients are people first, stakeholders second. Every framework, matrix, and communication plan exists to serve that principle — not replace it.

---

## The Four Roles

Every engagement has four stakeholder roles. Identifying them early prevents political surprises later.

### Executive Sponsor
The person with budget authority and organizational power. They don't need weekly details but must stay confident in the engagement's trajectory.

- **What they need:** High-level progress, ROI signals, early warning on risks, confidence that their investment is paying off
- **Communication cadence:** Bi-weekly or monthly executive brief
- **Common failure mode:** Over-communicating operational details they don't care about, or under-communicating so they lose visibility and confidence

### Day-to-Day Champion
Your primary collaborator and internal advocate. They need to feel ownership over the engagement's success and be equipped to sell progress internally.

- **What they need:** Shared accountability, clear action items, ammunition to advocate internally, feeling that they're a partner — not just a liaison
- **Communication cadence:** Weekly sync + 2-3x/week async updates
- **Common failure mode:** Treating them as a message-passer instead of a partner; not equipping them with talking points for internal conversations

### Technical Contacts
People you need access and information from. They need clear, specific requests — don't burden them with strategic context they don't need.

- **What they need:** Specific asks with clear deadlines, respect for their time, minimal meetings, context only when it helps them give better answers
- **Communication cadence:** As needed, usually async
- **Common failure mode:** Vague requests ("can you get me the data?") instead of specific ones ("I need a Salesforce report showing closed-won deals from Q4 with these fields: ...")

### Influenced Stakeholders
People whose workflows or teams will be affected by your work. They need to be heard early — even briefly — to prevent resistance later.

- **What they need:** Awareness of upcoming changes, opportunity to give input before decisions are final, reassurance that their concerns are being considered
- **Communication cadence:** Monthly or at key milestones, often via the Champion
- **Common failure mode:** Ignoring them until launch, then facing resistance from people who feel blindsided

---

## RACI Matrix Template

Map Responsible (does the work), Accountable (owns the outcome), Consulted (gives input before), Informed (told after) for each major deliverable or decision area.

| Deliverable / Decision | The Kiln (R) | Executive Sponsor (A) | Champion (C) | Technical Contact (C/I) | Broader Team (I) |
|---|---|---|---|---|---|
| GTM Stack Decisions | | | | | |
| Data & Enrichment | | | | | |
| Campaign Strategy | | | | | |
| Outbound Execution | | | | | |
| Reporting & Metrics | | | | | |
| [Add per engagement] | | | | | |

**How to use:** Fill this out during onboarding (Step 5) and revisit during crisis assessment or offboarding. The RACI clarifies who makes decisions vs. who does work — preventing the common failure of decisions stalling because ownership is unclear.

---

## Power-Interest Grid

Prioritize communication effort based on each stakeholder's power (ability to impact the engagement) and interest (how closely they follow it).

| | **High Interest** | **Low Interest** |
|---|---|---|
| **High Power** | **Manage Closely** — Your executive sponsor and champion live here. Proactive updates, early escalation, collaborative decision-making. | **Keep Satisfied** — CEO, CFO, board members. Brief updates only. Don't waste their time but don't surprise them. |
| **Low Power** | **Keep Informed** — BDRs, individual reps, marketing ops. They care about changes that affect their workflows. Include them in relevant decisions. | **Monitor** — Adjacent teams, tangential stakeholders. Light touch unless something changes. |

**Practical application:** When time is limited (especially during crisis), this grid tells you where to spend communication energy first.

---

## Engagement Level Tracking

Track each stakeholder's current engagement level and the target level. When there's a gap, define specific actions to close it.

**Engagement levels:**
- **Unaware** — Doesn't know about the engagement or its impact on them
- **Resistant** — Aware but opposed or skeptical (often due to past experiences or feeling excluded)
- **Neutral** — Aware but neither supportive nor opposed
- **Supportive** — Understands the value and willing to help
- **Leading** — Actively championing the engagement internally

| Stakeholder | Role | Current Level | Target Level | Gap-Closing Action |
|---|---|---|---|---|
| [Name] | Executive Sponsor | Supportive | Leading | Share early wins, invite to quarterly review |
| [Name] | Champion | Supportive | Supportive | Maintain cadence, equip with internal talking points |
| [Name] | Technical Contact | Neutral | Supportive | Include in design decisions, show how their input shaped the outcome |
| [Name] | Influenced Stakeholder | Resistant | Neutral | 1:1 conversation to hear concerns, address specific objections |

**When to update:** At onboarding (initial map), during crisis assessment (re-evaluate trust), and during offboarding (identify transition owners).

---

## Communication Cadence Template

Default cadence — adapt per client preference and engagement phase.

| Channel | Audience | Frequency | Content |
|---|---|---|---|
| **Weekly sync** (30 min) | Champion + key contacts | Weekly | Progress, blockers, decisions needed, upcoming milestones |
| **Async update** (Slack/email) | Champion | 2-3x/week | Quick status, wins, questions, heads-up on anything brewing |
| **Executive brief** | Sponsor | Bi-weekly or monthly | Results summary, trajectory, risks, decisions needed at their level |
| **Stakeholder check-in** | Influenced parties | As needed / monthly | Listen first, then preview upcoming changes, gather input |

**Crisis mode adjustments:**
- Async updates become daily or every-other-day
- Executive brief frequency increases to weekly
- Champion sync may become daily standups

**Offboarding adjustments:**
- Add knowledge transfer sessions (weekly, time-boxed)
- Add handoff confirmation meetings
- Schedule post-engagement 30-day check-in

---

## The Consultative Guidance Pattern

The core tension in consulting: you're the expert, but the client must feel ownership of decisions. This 4-step pattern resolves that tension.

### The Pattern

1. **Acknowledge their perspective genuinely**
   - "I understand why you'd want to prioritize volume — getting meetings on the board feels urgent."

2. **Share the trade-off or risk**
   - "The challenge is that pushing volume before the infrastructure is ready typically leads to deliverability problems that take weeks to recover from."

3. **Offer your recommendation with evidence**
   - "What I've seen work better is starting with a controlled launch — 50 emails/day for the first two weeks — while we validate inbox placement. Based on the Sendbird engagement, this approach caught issues early that would have cost 3 weeks of downtime."

4. **Give them the decision**
   - "Ultimately this is your call — I want to make sure you have the full picture so you can decide what makes sense for your timeline."

### Examples

**Good execution:**
> "I hear you — getting campaigns live fast is a priority. The risk with skipping the validation step is that we've seen bounce rates spike to 20% when lists aren't cleaned, which auto-pauses campaigns and costs more time than the validation would have taken. My recommendation is to run a 200-row test batch first — takes 24 hours and saves us from a potential 2-week setback. What do you think?"

**Bad execution (too vendor-like):**
> "Per our process, we need to validate the list before sending. This is a required step."

**Bad execution (too passive):**
> "Sure, we can skip validation if you want. It might cause some issues but we'll deal with it."

### Key rules
- Never say "no" without an alternative
- Never silently comply with something you know will fail — that erodes trust faster than respectful pushback
- Never bulldoze — even when you're right, the client needs to feel like they chose the path
- Frame recommendations as evidence-based, not opinion-based
- When the client overrides your recommendation, document it and execute their choice fully — no passive-aggressive "I told you so" later

---

## Principles

1. **See clients as people first, stakeholders second.** They have pressures, fears, and ambitions that don't show up in project plans. Understand those.

2. **Their priorities are your priorities** — genuinely, not performatively. If the client says something matters, it matters. If you disagree on approach, use the Consultative Guidance Pattern — don't dismiss their priorities.

3. **Proactive communication > reactive updates.** The client should never be the first to discover a problem. Silence is worse than bad news. Speculation fills voids — control the narrative.

4. **Guide while preserving their sense of agency.** Provide options, make a recommendation, and let them decide. Even when you're leading, they should feel like they're driving.

5. **Bad news delivered early and cleanly builds more trust than good news delivered late.** Acknowledge missteps openly. Frame with what's being done about it. Lead with solutions, not excuses.

6. **Calibrate to the person, not the role.** Some executives want details. Some operators want the bottom line. Ask early: "How do you prefer to get updates?" and adapt.

7. **Feedback loops are mandatory, not optional.** Every major decision should loop back to the client for confirmation. Every delivery should include a "does this match what you expected?" moment.

---

**Created:** 2026-03-08
**Status:** Active
**Version:** 1.0.0
