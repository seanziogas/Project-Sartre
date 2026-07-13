import { z } from 'zod'
import { parseJsonArray, parseJsonObject } from './llm.js'
import type { LlmClient } from './llm.js'

/**
 * List Grader (skill-patterns.md Pattern 1, generalized from the Hologram
 * classifier). Batch classify → adversarial review → retry-until-quality.
 * Client-agnostic: everything client-specific arrives via the brain context
 * and config; nothing here knows what a "Hologram" is.
 */

export const SKILL_ID = 'list-grader@0.1.0'

export interface GraderRow {
  id: string
  /** Fields shown to the classifier, e.g. name, website, description. */
  fields: Record<string, string | null>
}

export const Grade = z.object({
  id: z.string(),
  score: z.number().int().min(1).max(100),
  /** Controlled-vocabulary labels, semicolon-joined for multi-select. */
  labels: z.record(z.string(), z.string()),
  reasoning: z.string(),
})
export type Grade = z.infer<typeof Grade>

const Review = z.object({
  batch_score: z.number().min(0).max(100),
  issues: z.array(z.string()),
  summary: z.string(),
})

export interface GraderConfig {
  /** Concatenated brain grounding: icp + use-cases + industries + grading rulebook + case studies. */
  brainContext: string
  /** Controlled vocabularies per label field; classifier output is validated against these. */
  vocabularies: Record<string, string[]>
  /** Grading-rulebook floor rules restated for the reviewer, e.g. "confirmed cellular + relevant industry = 66 minimum". */
  reviewerRules: string[]
  batchSize?: number // default 20
  maxRetries?: number // default 3
  minReviewerScore?: number // default 75
}

export interface BatchJournalEntry {
  batchIndex: number
  attempts: {
    attempt: number
    reviewerScore: number | null
    issues: string[]
    parseFailure: boolean
  }[]
  accepted: boolean
}

export interface GradeListResult {
  grades: Grade[]
  journal: BatchJournalEntry[]
  /** Rows the model never produced a valid grade for — surfaced, not dropped. */
  ungraded: string[]
}

export async function gradeList(
  rows: GraderRow[],
  config: GraderConfig,
  llm: LlmClient,
  onBatchComplete?: (done: number, total: number) => void | Promise<void>,
): Promise<GradeListResult> {
  const batchSize = config.batchSize ?? 20
  const maxRetries = config.maxRetries ?? 3
  const minScore = config.minReviewerScore ?? 75
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error('batchSize must be a positive integer')
  if (!Number.isInteger(maxRetries) || maxRetries < 1) throw new Error('maxRetries must be a positive integer')

  const grades: Grade[] = []
  const journal: BatchJournalEntry[] = []
  const batches: GraderRow[][] = []
  for (let i = 0; i < rows.length; i += batchSize) batches.push(rows.slice(i, i + batchSize))

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b]!
    const entry: BatchJournalEntry = { batchIndex: b, attempts: [], accepted: false }
    let accepted: Grade[] | null = null
    let lastValid: Grade[] | null = null
    let carriedIssues: string[] = []

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const raw = await llm.complete({
        system: classifierSystem(config),
        user: classifierUser(batch, carriedIssues),
      })
      const parsed = parseGrades(raw, batch, config)
      if (!parsed.grades) {
        entry.attempts.push({ attempt, reviewerScore: null, issues: parsed.problems, parseFailure: true })
        carriedIssues = parsed.problems
        continue
      }
      if (parsed.problems.length > 0) {
        // structurally valid but violates vocab/coverage — retry with specifics
        entry.attempts.push({ attempt, reviewerScore: null, issues: parsed.problems, parseFailure: false })
        carriedIssues = parsed.problems
        continue
      }
      lastValid = parsed.grades

      const reviewRaw = await llm.complete({
        system: reviewerSystem(config),
        user: reviewerUser(batch, parsed.grades),
      })
      const review = Review.safeParse(parseJsonObject(reviewRaw))
      if (!review.success) {
        entry.attempts.push({ attempt, reviewerScore: null, issues: ['reviewer output unparseable'], parseFailure: true })
        continue
      }
      entry.attempts.push({
        attempt,
        reviewerScore: review.data.batch_score,
        issues: review.data.issues,
        parseFailure: false,
      })
      if (review.data.batch_score >= minScore) {
        accepted = parsed.grades
        break
      }
      carriedIssues = review.data.issues
    }

    // Max retries exhausted → accept the last structurally-valid result (the
    // proven behavior) but journal it as unaccepted so review queues can flag it.
    const final = accepted ?? lastValid
    entry.accepted = accepted !== null
    if (final) grades.push(...final)
    journal.push(entry)
    await onBatchComplete?.(b + 1, batches.length)
  }

  const gradedIds = new Set(grades.map((g) => g.id))
  const ungraded = rows.map((r) => r.id).filter((id) => !gradedIds.has(id))
  return { grades, journal, ungraded }
}

function classifierSystem(config: GraderConfig): string {
  const vocab = Object.entries(config.vocabularies)
    .map(([field, values]) => `- ${field}: ${values.join(' | ')}`)
    .join('\n')
  return [
    'You are a GTM analyst grading prospect accounts for fit. Ground every judgment in the client context below — it is the constitution; follow its grading posture, hard disqualifiers, and floor rules exactly.',
    '',
    '=== CLIENT CONTEXT ===',
    config.brainContext,
    '=== END CLIENT CONTEXT ===',
    '',
    'Controlled vocabularies (labels MUST come from these lists; join multiple values with "; "):',
    vocab,
    '',
    'Respond with ONLY a JSON array. One object per input row: {"id": string, "score": integer 1-100, "labels": {field: value}, "reasoning": string}. Every input row must appear exactly once.',
  ].join('\n')
}

function classifierUser(batch: GraderRow[], issues: string[]): string {
  const rows = batch
    .map((r) => {
      const fields = Object.entries(r.fields)
        .filter(([, v]) => v !== null && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
      return `--- id: ${r.id} ---\n${fields}`
    })
    .join('\n\n')
  const issueBlock =
    issues.length > 0
      ? `\n\nISSUES FROM PREVIOUS ATTEMPT TO FIX:\n${issues.map((i) => `- ${i}`).join('\n')}`
      : ''
  return `Grade these ${batch.length} accounts:${issueBlock}\n\n${rows}`
}

function reviewerSystem(config: GraderConfig): string {
  return [
    'You are a senior RevOps analyst auditing a batch of account grades produced by another analyst. Be adversarial: your job is to catch grading errors, not to be agreeable.',
    '',
    'Enforcement rules (violations are issues, no exceptions):',
    ...config.reviewerRules.map((r) => `- ${r}`),
    '- A batch where everything scores 55-65 is suspicious — grades should discriminate.',
    '- Reasoning must actually support the score; generic reasoning is an issue.',
    '',
    '=== CLIENT CONTEXT ===',
    config.brainContext,
    '=== END CLIENT CONTEXT ===',
    '',
    'Respond with ONLY a JSON object: {"batch_score": number 0-100, "issues": [string], "summary": string}. batch_score reflects overall batch quality; list one issue per problem, naming the row id.',
  ].join('\n')
}

function reviewerUser(batch: GraderRow[], grades: Grade[]): string {
  return `INPUT ROWS:\n${JSON.stringify(batch, null, 2)}\n\nGRADES TO AUDIT:\n${JSON.stringify(grades, null, 2)}`
}

function parseGrades(
  raw: string,
  batch: GraderRow[],
  config: GraderConfig,
): { grades: Grade[] | null; problems: string[] } {
  const arr = parseJsonArray(raw)
  if (!arr) return { grades: null, problems: ['output was not a JSON array'] }

  const problems: string[] = []
  const grades: Grade[] = []
  const inputIds = new Set(batch.map((row) => row.id))
  const seenIds = new Set<string>()
  for (const item of arr) {
    const parsed = Grade.safeParse(item)
    if (!parsed.success) {
      problems.push(`invalid grade object: ${JSON.stringify(item).slice(0, 120)}`)
      continue
    }
    if (!inputIds.has(parsed.data.id)) problems.push(`row ${parsed.data.id}: id was not present in the input batch`)
    if (seenIds.has(parsed.data.id)) problems.push(`row ${parsed.data.id}: duplicate grade in output`)
    seenIds.add(parsed.data.id)
    for (const field of Object.keys(config.vocabularies)) {
      if (!(field in parsed.data.labels)) problems.push(`row ${parsed.data.id}: missing label field "${field}"`)
    }
    for (const [field, value] of Object.entries(parsed.data.labels)) {
      const vocab = config.vocabularies[field]
      if (!vocab) {
        problems.push(`row ${parsed.data.id}: unknown label field "${field}"`)
        continue
      }
      const bad = value.split(';').map((v) => v.trim()).filter((v) => !vocab.includes(v))
      if (bad.length > 0) problems.push(`row ${parsed.data.id}: label(s) not in ${field} vocabulary: ${bad.join(', ')}`)
    }
    grades.push(parsed.data)
  }

  const ids = new Set(grades.map((g) => g.id))
  for (const row of batch) {
    if (!ids.has(row.id)) problems.push(`row ${row.id} missing from output`)
  }
  if (grades.length === 0) return { grades: null, problems }
  return { grades, problems }
}
