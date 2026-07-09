import { parseBrainDoc, validateBrainDocRules } from '@sartre/core'
import type { BrainFrontmatter } from '@sartre/core'
import type { LlmClient } from './llm.js'

/**
 * Brain Builder v1 (Layer 3): onboarding pipeline that drafts a client Brain
 * from raw source material — website scrape, closed-won/lost CRM analysis,
 * transcript mining, stakeholder interviews. Every output is `status: draft`;
 * the GTME approves (flips to active with approved_by) — the human gate is
 * structural, this skill cannot produce an active brain doc.
 *
 * Storage-agnostic: takes source texts in, returns validated markdown out.
 * The caller (pipeline or Claude Code session) writes files to
 * clients/<name>/brain/.
 */

export const SKILL_ID = 'brain-builder@0.1.0'

export interface BrainSource {
  kind: 'website' | 'crm_closed_won' | 'crm_closed_lost' | 'transcript' | 'interview' | 'document'
  /** Attribution label, e.g. "2026-07-01-kickoff-call" — cited in [VERIFIED: …] tags. */
  label: string
  text: string
}

export interface BrainDraft {
  file: string // e.g. "icp.md"
  markdown: string
  frontmatter: BrainFrontmatter
}

export interface BrainBuildResult {
  drafts: BrainDraft[]
  /** Doc types that failed to validate after retries — build them by hand. */
  failed: { docType: string; problems: string[] }[]
}

/** The v1 build set: required brain docs the sources can plausibly ground. */
const BUILD_SET: { docType: string; file: string; contract: string }[] = [
  {
    docType: 'company',
    file: 'company.md',
    contract:
      'Sections: Overview / Products & Pricing / Core Value Props / Buying Motion / Key Customers / Competitive Landscape / Market Trends / Engagement Context.',
  },
  {
    docType: 'icp',
    file: 'icp.md',
    contract:
      'Sections: Executive Summary / Minimum Qualifications / Firmographic Profile / Verticals by Tier / Disqualifiers (Immediate Disqualifiers, Requires Careful Qualification, When to Walk Away) / Deal Size Distribution / Sales Motion by Segment. Ground disqualifiers in closed-lost evidence.',
  },
  {
    docType: 'voice',
    file: 'voice.md',
    contract:
      'Sections: Personality Traits (each with "what it means" and "in practice") / Tone by Context / Language Do & Don\'t / Rewrite Examples (generic → branded) / Hard Constraints. Derive from website copy.',
  },
  {
    docType: 'grading',
    file: 'grading.md',
    contract:
      'Sections: Posture (state generous or strict FIRST, and set frontmatter `posture`) / Hard Disqualifiers / Floor Rules (explicit "X + Y = minimum Z" rules) / Score Bands ↔ Grades / Edge Cases. Ground floor rules in closed-won patterns.',
  },
  {
    docType: 'use-cases',
    file: 'use-cases.md',
    contract:
      'Sections: Use-Case Types (per entry: Definition / Keywords & signals / Data profile / Examples) / Industry Mapping / Campaign Targeting Implications. Set frontmatter `vocabulary` to the list of use-case names.',
  },
]

export async function buildBrain(
  clientName: string,
  sources: BrainSource[],
  llm: LlmClient,
  options: { today: string; maxRetries?: number } = { today: 'YYYY-MM-DD' },
): Promise<BrainBuildResult> {
  const maxRetries = options.maxRetries ?? 2
  const drafts: BrainDraft[] = []
  const failed: BrainBuildResult['failed'] = []

  const sourceBlock = sources
    .map((s) => `=== SOURCE [${s.kind}] ${s.label} ===\n${s.text}\n=== END SOURCE ===`)
    .join('\n\n')

  for (const spec of BUILD_SET) {
    let problems: string[] = []
    let done = false
    for (let attempt = 0; attempt <= maxRetries && !done; attempt++) {
      const raw = await llm.complete({
        system: builderSystem(clientName, spec.docType, spec.contract, options.today),
        user:
          problems.length > 0
            ? `${sourceBlock}\n\nPREVIOUS ATTEMPT FAILED VALIDATION — FIX:\n${problems.map((p) => `- ${p}`).join('\n')}`
            : sourceBlock,
        maxTokens: 32000,
      })
      const check = validateDraft(raw, spec.docType, clientName)
      if (check.ok) {
        drafts.push({ file: spec.file, markdown: raw.trim() + '\n', frontmatter: check.frontmatter })
        done = true
      } else {
        problems = check.problems
      }
    }
    if (!done) failed.push({ docType: spec.docType, problems })
  }

  return { drafts, failed }
}

function builderSystem(clientName: string, docType: string, contract: string, today: string): string {
  return [
    `You are drafting the "${docType}" document of a client Brain for ${clientName} — the structured knowledge that grounds every downstream automation. Work ONLY from the provided sources.`,
    '',
    'Attribution discipline (non-negotiable):',
    '- Every client-specific fact carries [VERIFIED: <source label>] placed after the claim.',
    '- Deductions carry [INFERRED: <one-line logic>].',
    '- If you cannot support a section from the sources, write the section header with "TODO: not derivable from sources" — honesty over confident guessing. Never invent customers, numbers, or quotes.',
    '',
    `Output a single markdown file. Structure contract: ${contract}`,
    '',
    'Frontmatter (exact YAML block first, then the body):',
    '---',
    `brain_doc: ${docType}`,
    `client: ${clientName}`,
    'status: draft',
    `updated: ${today}`,
    'sources: [<one entry per source label actually used>]',
    'approved_by: ""',
    '---',
    '',
    'Respond with ONLY the markdown file content. No commentary, no code fences.',
  ].join('\n')
}

function validateDraft(
  raw: string,
  docType: string,
  clientName: string,
): { ok: true; frontmatter: BrainFrontmatter } | { ok: false; problems: string[] } {
  let parsed
  try {
    parsed = parseBrainDoc(raw.trim() + '\n')
  } catch (err) {
    return { ok: false, problems: [(err as Error).message] }
  }
  const problems: string[] = []
  if (parsed.frontmatter.brain_doc !== docType) {
    problems.push(`frontmatter brain_doc must be "${docType}", got "${parsed.frontmatter.brain_doc}"`)
  }
  if (parsed.frontmatter.client !== clientName) {
    problems.push(`frontmatter client must be "${clientName}"`)
  }
  if (parsed.frontmatter.status !== 'draft') {
    problems.push('status must be "draft" — only a human approval flips a brain doc active')
  }
  if (parsed.body.trim().length < 100) {
    problems.push('body is implausibly short')
  }
  problems.push(...validateBrainDocRules(parsed.frontmatter))
  if (problems.length > 0) return { ok: false, problems }
  return { ok: true, frontmatter: parsed.frontmatter }
}
