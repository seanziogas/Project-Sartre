> **Provenance:** imported 2026-07-09 from cxt_hub read-only reference copy (`roles/00_pod_structure.md`). Maintained in Sartre from now on; upstream is never edited from this repo.

# Pod Structure & Role Interactions

## Overview

The pod is The Kiln's core unit of delivery. Every client engagement is serviced by a single pod. Every pod has three people: a Managing Director (MD), a Go-to-Market Engineer (GTME), and a Technical Operations Specialist (TOS). Each pod runs three client engagements simultaneously.

The three roles are not equal contributors to the same work — they operate at different layers of the engagement. The MD owns strategy and oversight. The GTME owns client communication and work direction. The TOS owns execution. Understanding how these layers interact is essential to understanding how The Kiln operates.

---

## The Three Layers

**MD — Strategic Layer**
The MD is responsible for the health of the engagement at a portfolio level. They monitor timelines, maintain the business impact narrative, coach the GTME, and handle commercial conversations (extensions, expansions, service issues). Their job is to ensure the engagement is going in the right direction — not to be involved in the day-to-day mechanics of building.

**GTME — Translational Layer**
The GTME is the hub of the pod. They translate client goals into build direction for the TOS, and translate technical output back into client-facing communication. They own the client relationship, manage the TOS's work, and are responsible for the quality and timeliness of everything the pod delivers. The GTME is the central communication node between all three parties.

**TOS — Execution Layer**
The TOS receives direction from the GTME and builds. They are not client-facing and do not set strategy. A good TOS can take specific, step-by-step direction and execute it with speed and quality. A great TOS can take higher-level, less specific direction (e.g., "build an outbound campaign with these personalizations and this target list") and produce polished work independently — doing a first draft of strategy, handling initial QA, and flagging risks. All TOS work closely with the GTME throughout the build process — not in isolation.

---

## How Work Flows Through the Pod

### Standard Flow

1. **Client → GTME**: The client communicates their goals, desired outcomes, and any relevant context on their weekly call and async via Slack. The GTME is responsible for deeply understanding the client's business context, goals, and success criteria.

2. **GTME → TOS**: The GTME translates the client's goals into a concrete build brief. This includes what needs to be built, why (client context), what the expected output looks like, and any relevant technical constraints. The GTME is also responsible for scoping which parts of the build they will handle directly vs. delegate to the TOS.

3. **TOS → Build**: The TOS processes the brief, asks clarifying questions, and executes. Most builds are Clay-centric, potentially connected to CRMs, sequencers, and custom scripts. The TOS works closely with the GTME throughout the build — it's a tight feedback loop, not a handoff-and-disappear dynamic.

4. **GTME QAs**: Before anything is shipped or presented to the client, the GTME reviews the TOS's work against three criteria: cost efficiency (could this be built more efficiently?), output quality (does it do what it was supposed to do?), and client context alignment (does this actually fit how the client will use it in production?). The TOS then addresses any feedback.

5. **GTME → Client**: The GTME communicates progress, deliverables, and outcomes to the client. The TOS is never in this conversation. Client-facing communication is exclusively the GTME's responsibility.

### Where the MD Fits

The MD is not in the day-to-day flow above. Their touchpoints are:

- **Weekly 1:1 with each GTME** (30–45 min): A structured health check across all three clients. The GTME updates the MD on progress, flags any issues, and gets coaching or guidance as needed. If things are going smoothly, this is brief. If there are problems, this is where they surface.
- **Early in new engagements**: The MD is more hands-on in the first month of any new engagement — attending client calls, helping the GTME establish rapport, and setting the tone. As the GTME settles in, the MD steps back.
- **Escalations**: When issues arise (unhappy client, timeline risk, scope creep), the GTME flags to the MD immediately. The MD helps form a response plan and may engage with the client directly on commercial or strategic matters.
- **Impact narrative**: The MD maintains awareness of the engagement's business impact story — what was delivered, what measurable outcomes resulted, how to frame the engagement for extension/expansion conversations.

---

## Communication Lines

| From | To | Channel | Cadence | Purpose |
|---|---|---|---|---|
| GTME | Client | Slack (async) | Mon / Wed / Fri | Progress updates, blockers, questions |
| TOS | Client | Slack (async) | Mon / Wed / Fri | Daily/recurring updates (Senior/great TOS only) |
| GTME | Client | Video call | Weekly (30–60 min) | Status, strategy, relationship |
| TOS | Client | Slack (one-off) | As needed | Simple requests (Senior/great TOS only; GTME handles strategic comms) |
| GTME | TOS | Async / sync | As needed | Build briefs, feedback, unblocking |
| GTME | MD | Weekly 1:1 | Weekly (30–45 min) | Account health check, coaching |
| MD | Client | Video call | As needed (heavily in month 1, occasional after) | Kickoff, escalations, commercial |
| MD | GTME | Weekly 1:1 + ad hoc | Weekly + as needed | Oversight, coaching, strategy |
| MD | TOS | Ad hoc only | Rare | Only when GTME is unavailable or issue requires it |
| All | All | Team meetings | Weekly (~1.5–2 hrs total) | Monday All-Hands (30 min), Thursday Kiln Combinator (creative exploration), Friday All-Hands (workshops/walkthroughs) |
| GTME | Project tracking | Monday.com | Ongoing | Keep boards updated with project status, task owners, goal completion dates, status updates |
| TOS | Client channels | Slack (monitoring) | Ongoing | Monitor client Slack channels for awareness and context, even when not initiating communication |

**Note on MD ↔ TOS communication**: The MD and TOS do not have a regular direct relationship. The GTME is the intended communication path. The MD will engage the TOS directly only in two situations: (1) the GTME is out of office and the MD steps into the GTME role, or (2) a performance or collaboration issue with the TOS is identified and needs to be addressed directly.

---

## Decision Ownership

| Decision Type | Owner | Notes |
|---|---|---|
| Client strategy and goals | Client | The Kiln does not set strategy for clients — clients define the desired outcome |
| What to build and why | GTME | Translates client goals into specific projects and build direction |
| How to build it | TOS (+ GTME for complex/novel builds) | GTME builds the hardest parts or anything requiring deep client context |
| Client communication | GTME | All client-facing communication runs through the GTME |
| Commercial decisions (extensions, pricing, scope) | MD | MD owns all commercial conversations with clients |
| GTME performance and development | MD | MD assesses GTMEs against the three pillars and coaches accordingly |
| GTME-to-client matching | MD | MD determines which GTME is best suited for each incoming client |
| Build quality sign-off | GTME | GTME QAs all TOS output before it reaches the client |
| Escalation response | MD + GTME | GTME flags, MD helps strategize; MD may engage client directly |

---

## The GTME as Translational Layer

The GTME's most important function is translation — not just communication, but genuine translation between two different frames of reference.

The client thinks in terms of business outcomes: "We need to save our reps time," "We want to increase the quality of leads in our pipeline," "We want to know which accounts to prioritize." They don't think in systems or tools.

The TOS thinks in terms of systems and execution: inputs, outputs, data flows, tool connections, build logic.

The GTME has to hold both frames simultaneously. When they receive direction from the client, they need to translate it into a build brief that is specific, technically actionable, and includes the business context the TOS needs to make good judgment calls during the build. When they review TOS output, they need to evaluate it through the lens of the client's actual goals — not just whether the system works technically.

A GTME who can't do this translation effectively creates a gap. The TOS builds something that technically functions but doesn't fit the client's production context. The client gets something that doesn't match their mental model. The engagement suffers.

---

## Escalation Paths

**Client is unhappy or at churn risk**
1. GTME identifies the issue and flags to MD immediately — this is a non-negotiable first step.
2. GTME and MD form a response plan together.
3. GTME addresses it directly with the client — surfaces the tension openly, asks for feedback, opens the communication.
4. If the situation requires commercial negotiation or executive-level conversation, MD engages with the client directly.

**Client is pushing for scope creep**
1. GTME flags to MD.
2. MD helps GTME understand whether to push back and how hard.
3. MD provides specific talk tracks for handling the client conversation.
4. GTME leads the client-facing response; MD may join the call if needed.

**GTME is underperforming or a build is behind**
1. MD identifies the issue in the weekly 1:1 or through client feedback.
2. MD determines root cause — skill gap, GTME/TOS dynamic, scope issue, or external factor.
3. MD coaches the GTME; in rare cases, dives into the work directly to unblock in the short term.
4. Direct execution by the MD is always paired with a coaching conversation — the goal is to fix the underlying issue, not just the immediate problem.

**GTME is out of office**
1. MD steps in as acting GTME for the duration.
2. MD works directly with the TOS in a standard GTME/TOS collaborative capacity.
3. MD handles any required client communication.

---

## New Engagement Ramp

The pod's dynamic changes at the start of a new engagement. The MD is more involved, the GTME is still establishing client rapport, and the TOS may be operating without full context on the client.

**Phases:**
1. **Sales handoff**: MD and GTME receive the handoff document from sales (includes SOW, call notes, client background). GTME leads a kickoff call with MD and the sales team to ask all necessary questions.
2. **Pre-work**: GTME reviews SOW, identifies gaps in knowledge, syncs with MD for training materials or guidance on anything unfamiliar.
3. **Activation phase**: First week or two of the engagement. Getting access to client tools (CRM, sequencers, internal systems), exploring the CRM and data landscape, meeting any additional client stakeholders needed for the build.
4. **Build phase**: The bulk of the engagement. GTME and TOS building against the roadmap, with MD checking in via weekly 1:1s and attending client calls as needed until the engagement is running smoothly.

The MD attends all client calls during the first month of a new engagement. As the GTME establishes confidence and the client relationship stabilizes, the MD steps back to their standard 2 hrs/week sold allocation.

---

## How the MD Manages Across Five Pods

An MD oversees five GTMEs, each running three clients — 15 client engagements in total. With only 2 sold hours per client per week, the MD cannot be deeply involved in every account. Their time allocation is dynamic:

- Smooth accounts with strong GTMEs may require as little as 10 minutes per week.
- New engagements or struggling accounts may require significantly more — up to 40 hours per week of client work in demanding periods.

The MD's weekly GTME 1:1s are the primary mechanism for staying on top of the portfolio. If a GTME doesn't flag anything, the MD has little to do on those accounts. The MD's skill is in reading between the lines — knowing which GTMEs underreport problems, which accounts carry hidden risk, and where to direct attention proactively.

---

## What Clients See

Clients interact almost exclusively with the GTME. The GTME is their day-to-day point of contact, attends every call, and handles all strategic communication.

The MD is visible to clients but positioned as a senior resource operating in the background. Clients know who the MD is (introduced at kickoff), understand they can escalate to them if needed, and know the MD handles commercial conversations. But the MD is not the relationship — the GTME is.

The TOS is generally invisible to clients. However, great and Senior TOS members may handle specific client-facing communications for efficiency:
- **Daily/recurring updates:** Mon/Wed/Fri Slack update messages (what we did, what's in progress, blockers) can be drafted and sent by the TOS since they have full visibility into execution.
- **Simple one-off requests:** Quick, non-strategic Slack questions from clients ("Are you using our Anthropic or OpenAI API key?") can be answered directly by a TOS — they acknowledge the request, check, and reply with the answer.

These communications stay operational and do not involve strategic direction, business decisions, or relationship management — the GTME and MD remain the primary relationship touchpoints. From the client's perspective, the TOS typically remains unseen.
