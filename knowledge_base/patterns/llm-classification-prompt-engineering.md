> **Provenance:** imported 2026-07-09 from kiln-os read-only reference copy (`knowledge_base/patterns/llm-classification-prompt-engineering.md`). Anonymized cross-client pattern; extraction rubric applies to all future additions.

---
type: pattern
date: 2026-02-27
source: client-engagement-extraction
tags: [llm, prompt-engineering, data-classification, structured-outputs]
---

# LLM Classification Prompt Engineering

Patterns for using LLMs to classify and standardize CRM/business data at scale. Focused on eliminating hallucinations and achieving deterministic outputs.

## Core Principle

**Use structured outputs, not just instructions.**

Telling an LLM "classify this into one of 25 categories" produces hallucinations. Providing the exact 25 categories as a constrained output schema eliminates them.

## Pattern: Constrained Classification

### Before (94.8% accuracy)
```
Classify this company's industry into one of our standard categories.
Categories: SaaS, FinTech, HealthTech, ...
```
**Problem:** LLM invents variations ("Software-as-a-Service", "Financial Technology", "Health & Wellness Tech") — ~200 unique values instead of 25.

### After (100% accuracy)
```
Classify this company's industry. You MUST respond with exactly one of these values:
["SaaS", "FinTech", "HealthTech", ...]

Use structured output / JSON schema with enum constraint.
```
**Fix:** Structured output with enum constraint. LLM can ONLY return a value from the allowed list.

## Model Selection Guidance

| Use Case | Recommendation | Why |
|---|---|---|
| Simple classification (industry, size bucket) | Low-cost model with structured outputs | Constraint does the heavy lifting, not reasoning |
| Nuanced classification (sentiment, intent) | Mid-tier model | Needs reasoning ability |
| Multi-factor analysis | Higher-tier model | Complex context window needed |
| Data standardization (formatting, dedup) | Low-cost model | Pattern matching, not reasoning |

**Key lesson:** Low-cost models hallucinate even with clear text instructions. The fix isn't a better model — it's structured outputs that mechanically constrain the response space.

## Implementation Checklist

- [ ] Define exact output schema (enum values, field types, required fields)
- [ ] Use API-level structured output enforcement (not just prompt instructions)
- [ ] Test on 100+ real examples before production
- [ ] Log and review edge cases (inputs that don't cleanly fit any category)
- [ ] Define a fallback category for genuinely ambiguous inputs (e.g., "Other" or "Unclassified")
- [ ] Monitor classification distribution in production (catch drift or systematic misclassification)

## Anti-Patterns

- **"Be creative"** in classification prompts — you want the opposite of creativity
- **Open-ended text responses** for categorical data — always constrain the output space
- **Assuming model upgrade fixes accuracy** — structured outputs on a cheap model often beats an expensive model with free-text output
- **Skipping the audit step** — always compare LLM output against human-verified ground truth on a sample
