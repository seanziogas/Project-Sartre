> **Provenance:** imported 2026-07-09 from cxt_hub read-only reference copy (`delivery/03_track_delivery_process.md`). Maintained in Sartre from now on; upstream is never edited from this repo.

# Track Delivery Process

## Overview

A "track" is the unit of delivery at The Kiln. Each track is a scoped system build — a discrete chunk of work defined in the SOW with a clear input, output, and acceptance criteria. Most engagements run 2–4 tracks sequentially or in parallel, depending on scope and client complexity.

This document covers how a track moves from scoped to shipped: the full lifecycle from scoping to QA to client handoff.

---

## Track Lifecycle

```
Scoped → Briefed → Built → QA'd → Shipped → Adopted
```

Each stage has specific inputs, outputs, and owners.

---

## Stage 1: Scoping

**Owner:** GTME (with MD alignment)

### How Scoping Actually Works

The lifecycle diagram above shows scoping as a clean, discrete phase. In reality, it's rarely that neat. Scoping happens in layers across three moments:

1. **During the sales process** — High-level scope is defined in the SOW. Track names, general deliverables, and the overall engagement shape are set before the GTME even sees the deal. This is the starting point, not the finished scope.
2. **During the activation phase** — The GTME digs into the client's systems, asks questions, and starts to understand what's actually feasible. Scoping sharpens here. What looked like a straightforward CRM enrichment track might reveal a messy data model that changes the approach entirely.
3. **Just before building** — The final, most specific layer of scoping often happens right before (and sometimes bleeding into) the build itself. The GTME learns something during the brief-writing process that changes the plan. Or they start building and discover a constraint that forces a pivot.

These layers bleed into each other. The GTME is often scoping, briefing, and starting to build in overlapping timeframes rather than completing one before moving to the next. That's normal. The goal is not to follow a rigid waterfall — it's to make sure scope is sufficiently clear before committing significant build time, and that the client has confirmed the direction in writing before the pod invests heavily.

### What a Scope Should Define

Regardless of when or how it solidifies, a scope needs to capture:
- **What we're building** — the system, workflow, or output
- **What it does** — what problem it solves, what the client gets
- **What it doesn't do** — explicit out-of-scope items to prevent scope creep
- **Inputs required** — what the client must provide before building can start (account lists, CRM access, API keys, field definitions, etc.)
- **Acceptance criteria** — what "done" looks like; how the client and GTME will know the track is complete
- **Timeline** — when the build starts and when delivery is expected

**Scoping happens in writing.** The GTME sends a brief Slack message or Notion doc capturing the scope and asks the client to confirm. Any verbal alignment that isn't documented isn't locked.

**Escalate to MD if:**
- The client is requesting something outside the SOW
- The GTME is unsure whether something is in scope
- The timeline in the SOW can't be met given current discovery findings

---

## Stage 2: Build Brief

**Owner:** GTME → TOS

Once scoped (or as scoping is solidifying), the GTME creates a build brief for the TOS. This is not a ticket — it's a handoff that gives the TOS everything they need to build without requiring constant check-ins.

A good build brief includes:

1. **What we're building** — plain-language description, not jargon
2. **Why** — client context, business goal, how it will be used in production
3. **Input → Output** — what goes in, what comes out
4. **Technical requirements** — tool stack, field mappings, integration points, constraints
5. **What the GTME will build** — what parts the GTME is handling directly (complex logic, novel architecture, anything requiring deep client context)
6. **What the TOS should build** — what's delegated and to what level of spec
7. **QA criteria** — what the TOS should check before handing back to the GTME
8. **Open questions** — anything unclear that the TOS should surface before or during the build

**The brief should be async-readable.** If the TOS needs a 30-minute kickoff call to understand every brief, the briefs aren't specific enough.

### Deciding What You Build vs. What Your TOS Builds

A critical part of the GTME's job during the briefing phase is deciding the division of labor. In practice, the TOS handles the majority of the build — the exact split varies by track and by the TOS's capabilities, but it's not uncommon for the TOS to own something like 80% of the work on a given track. That's not a target; it's just a realistic reflection of how the role is designed. The GTME should not be deep in the build for hours on work the TOS could handle — their time is better spent on client management, scoping the next track, and QA.

The key to delegating well is knowing your TOS's strengths. Every TOS has areas where they're fast, confident, and produce strong work — and areas where they're slower or less experienced. The GTME should route work accordingly.

**Example:** An outbound campaign track requires two components: (1) a personalization layer that pulls data from web scraping, and (2) a prompt engineering component using Claude to generate tailored messaging.

If the GTME knows their TOS has extensive experience with Firecrawl and has even written custom BeautifulSoup scripts in the past, the web scraping component should go to the TOS — they'll be faster and more reliable than the GTME on that work. But if the TOS is an English-as-a-second-language speaker, the Claude prompting piece — which requires nuanced language and iterative prompt refinement — is probably faster and higher quality if the GTME handles it directly.

In the brief, the GTME would explicitly assign the web scraping portion to the TOS, note that they'll handle the prompting piece themselves, and explain why. This isn't about hierarchy — it's about speed and quality. The goal is to play to each person's strengths so the track ships faster and better.

The GTMEs who do this well develop a mental model of their TOS's capabilities over time. They know what they can hand off with a light brief vs. what needs detailed spec vs. what they should just build themselves. This model updates as the TOS grows — what was a "GTME builds" item in Month 1 might become a "TOS builds" item by Month 3 if the TOS has been coached up on it.

---

## Stage 3: Build

**Owner:** TOS (GTME builds complex or novel components directly)

The TOS executes against the brief. This is a tight collaborative loop, not a hand-off-and-disappear dynamic.

**During the build:**
- TOS asks clarifying questions as they arise — don't wait until the end
- GTME is available for questions, feedback, and unblocking
- TOS tracks build progress in Monday.com — tasks should move from Not Started → In Progress → In Review as work progresses
- TOS flags risks early: if a data source isn't returning expected results, if a tool integration is more complex than expected, if timeline is at risk

**Who builds what:**
- **TOS builds:** Standard workflows, enrichment runs, CRM integrations, sequencer setups, repetitive or parameterized logic
- **GTME builds:** Novel architectures, anything requiring deep client context to get right, first-of-kind builds that will be templated later, anything TOS isn't yet confident to own

**GTME should not be doing TOS work on tracks the TOS can handle.** If the GTME is spending 20 hours on a build the TOS could have done with a good brief, something is wrong.

---

## Stage 4: QA

**Owner:** GTME

Before anything reaches the client, the GTME reviews the TOS's output. QA is not optional and is not the TOS's job to self-certify.

**Three QA lenses:**

1. **Cost efficiency** — Could this have been built more efficiently? Are we burning Clay credits unnecessarily? Is there a simpler solution that achieves the same outcome?

2. **Output quality** — Does it do what it was supposed to do? Are outputs accurate, clean, and formatted correctly? Is error handling in place?

3. **Client context alignment** — Does this actually fit how the client will use it in production? Does the field structure match their CRM schema? Does the output land in the right place? Would the client be surprised by anything?

**The GTME QAs with the client in mind, not just the brief.** The TOS built to the brief. The GTME checks whether the brief was right.

After QA, the GTME either:
- Approves the build and moves to Ship, or
- Returns to the TOS with specific, actionable feedback for revision

**QA feedback should be written.** Not a 15-minute verbal debrief. Documented in Slack or Notion so the TOS can reference it and patterns can be learned from over time.

---

## Stage 5: Ship

**Owner:** GTME

Once QA passes, the GTME ships the track to the client. This includes:

1. **Client demo or walkthrough** — Either live on the weekly call or async via a Loom. Show the output, explain what it does, walk through how they'll use it.
2. **Documentation** — A brief written summary of what was built, how it works, what inputs it needs, and how to maintain it. This doesn't need to be a 10-page manual — it needs to be enough that the client can operate it without us being on the phone.
3. **Handoff of any client-side setup** — If the client needs to do anything to operationalize the output (e.g., add a field in Salesforce, connect a new Slack channel), walk them through it and confirm completion.
4. **Monday.com updated** — Mark all tasks in the track as Done. Update the overall track status.

---

## Stage 6: Adoption

**Owner:** GTME (ongoing)

Shipping isn't done until the client is actually using the system. The GTME follows up in the week after shipping to confirm:
- The system is running as expected in production
- The client's team is using the output (reps are working the leads, data is flowing to the right place, etc.)
- Any issues that emerged post-launch are addressed

If adoption is low or the system isn't being used, find out why. A system that doesn't get used is not a win.

---

## Track Sequencing

Most engagements run tracks sequentially — Track 1 → Track 2 → Track 3. Some run in parallel if resources allow and dependencies don't create conflicts.

Sequencing logic:
- **Dependency-first** — If Track 2 depends on the CRM data cleaned up by Track 1, Track 1 goes first. Don't build on a broken foundation.
- **High-impact-first** — If sequencing is flexible, prioritize the track that delivers the most tangible value to the client first. Fast wins build trust and extend engagements.
- **Feasibility-constrained** — If a track is blocked by missing access, a pending approval, or a client-side dependency, don't let it block other progress. Pivot to a track that can move.

Track substitutions or sequence changes require explicit written client confirmation before the GTME changes course.

---

## Common Failure Modes

| Failure | Root Cause | Fix |
|---|---|---|
| Build doesn't match client expectations | Misalignment between The Kiln and the client during scoping | Communicate clearly with the client during scoping — written confirmation is ideal but the priority is clarity, not formality |
| TOS built the wrong thing | Build brief was too vague | Tighten the brief; add more client context and specific examples |
| QA finds major issues late in the build | QA wasn't happening continuously | GTME should do check-ins during the build, not just at the end |
| Client doesn't adopt the system | No adoption follow-up; no training | Explicitly check adoption 1 week post-ship and address barriers |
| Scope creep mid-build | Client added requirements informally | Surface scope additions immediately; confirm or push back in writing |
