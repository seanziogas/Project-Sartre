> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/frameworks/scoping-question-cascade.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
node_type: framework
client: Internal
date: 2026-04-21
status: in-progress
tags: [agency-strategy, scoping]
source: internal-meeting
attribution: "Mathias Powell, Drata kickoff prep call, 2026-04-21"
template: framework
related_concepts:
  - "[[activation-phase]]"
  - "[[client-onboarding]]"
---

# The "Why-Not-Today" Scoping Cascade

**Origin:** Mathias Powell, articulated during Drata kickoff prep call on 2026-04-21.

**Purpose:** A structured method for surfacing all questions and blockers for a deliverable *before* build begins — used during the activation phase of a client engagement.

---

## The Core Question

For each deliverable, ask:

> **"Why is this not done today? Why do we not have this for them today?"**

The client's answer surfaces the first layer of blockers. Each blocker triggers the next question. Repeat the cascade until the deliverable is fully unblocked in theory — i.e., you know exactly what you need from the client to build it.

---

## Mechanics

| Element | Standard |
|---|---|
| **Session length** | 20–30 min (up to 1 hour) |
| **Cadence** | Daily during activation phase |
| **Participants** | Builder pair — GTM engineer + ops specialist (in Kiln's model: Carlos + Joe) |
| **Scope per session** | **One deliverable at a time** — don't batch |
| **Output** | Consolidated question bank, digestible format, handed to client in one batch |

---

## Why It Works

Two mechanisms compound:

1. **Front-loaded scoping prevents mid-build re-scoping.** Most project slowdowns come from discovering unknowns mid-build. This method surfaces them before build starts, during a phase explicitly scoped for unblocking.

2. **Consolidated question format unlocks client speed.** Instead of the client fielding one-off questions over weeks, they get a single digestible batch they can answer in one sitting. Client velocity becomes the output, not the bottleneck.

**Expected downstream impact (Mathias):** if questions are answered cleanly, most deliverables build in **1–2 days** of focused work.

---

## Per-Deliverable Output Shape

For each deliverable the cascade should produce:

- The cascade of questions (ordered by dependency)
- Answers we already have or can confidently infer
- What we need from the client (answers)
- What we need from their systems (access, schema, data samples)
- Estimated build time *assuming* questions get answered

---

## When to Use

- **Always** during activation phase, before build starts
- Anytime a new deliverable is added mid-engagement
- As a diagnostic when a project stalls — run the cascade against it to find the missing question

---

## Mathias's Anchor Quote (Verbatim)

> "Essentially what we did that I think led to a lot of really quick progress during the first week or two weeks was... to really get the scoping piece nailed down, which is... the meat of it, is to go deliverable by deliverable. And essentially says, like, what do we need to do to build this? Like, why is this not done today? Like, why do we not have this for them today, essentially? And they'd be like, okay, well, we need to do this. And then that raises a whole slew of questions. And then next up, this, and that raises a whole suite of questions. And then from there, with just, like, for each deliverable, like a 20, 30-minute focused discussion between you and Joe can flesh out pretty much all the questions that you would need to give them up front in order to, if you had answers to those, then we would be able to build it in most of these, like, a day or two, like, realistically, for a lot of this stuff. So I would just approach it like that. I would just sit down on a call, even during the activation phase, if you and Joe get in a call for 30 minutes, an hour, each day, and just talk through these in-depth and flesh out just, like, all the questions you guys have around them, should be really, really productive. And then you can hand all those over in a very digestible format to them that'll allow them to unlock you guys, like, super quickly."

## On Why the Activation Phase Matters (Mathias)

> "Most of the issues we run into in projects stem from not having a delivery phase, or an activation phase in the past, like so many. So I think it just makes them run a lot, a lot smoother."

---

## Related Frameworks
- [[activation-phase]] — the 1–2 week window where this cascade runs
- [[client-onboarding]] — broader onboarding project type

## Change Log

| Date | Change | Source |
|---|---|---|
| 2026-04-21 | Initial framework documented | Drata kickoff prep call w/ Mathias + Ultan + Joe + Carlos |
