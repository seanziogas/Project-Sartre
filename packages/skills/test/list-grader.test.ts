import { describe, expect, it } from 'vitest'
import { gradeList } from '../src/list-grader.js'
import type { GraderConfig, GraderRow } from '../src/list-grader.js'
import type { LlmClient } from '../src/llm.js'

/** Scripted fake: returns queued responses in order, records prompts. */
class ScriptedLlm implements LlmClient {
  calls: { system: string; user: string }[] = []
  constructor(private responses: string[]) {}
  async complete(req: { system: string; user: string }): Promise<string> {
    this.calls.push(req)
    const next = this.responses.shift()
    if (next === undefined) throw new Error('fake LLM exhausted')
    return next
  }
}

const CONFIG: GraderConfig = {
  brainContext: '# Grading Rulebook\nPosture: generous.\nCompetitors score 1-20.',
  vocabularies: { industry: ['Fleet', 'Healthcare', 'Other'] },
  reviewerRules: ['Competitors MUST score 1-20'],
  batchSize: 2,
  maxRetries: 3,
  minReviewerScore: 75,
}

const ROWS: GraderRow[] = [
  { id: 'a', fields: { name: 'FleetCo', description: 'GPS trackers for trucks' } },
  { id: 'b', fields: { name: 'MedCo', description: 'Patient monitoring devices' } },
]

const goodGrades = JSON.stringify([
  { id: 'a', score: 80, labels: { industry: 'Fleet' }, reasoning: 'clear fleet fit' },
  { id: 'b', score: 70, labels: { industry: 'Healthcare' }, reasoning: 'monitoring fit' },
])
const passReview = JSON.stringify({ batch_score: 90, issues: [], summary: 'solid' })

describe('gradeList — eval set', () => {
  it('accepts a clean batch first try', async () => {
    const llm = new ScriptedLlm([goodGrades, passReview])
    const result = await gradeList(ROWS, CONFIG, llm)
    expect(result.grades).toHaveLength(2)
    expect(result.journal[0]!.accepted).toBe(true)
    expect(result.ungraded).toEqual([])
    // brain grounding actually reaches the model
    expect(llm.calls[0]!.system).toContain('Grading Rulebook')
    expect(llm.calls[1]!.system).toContain('Competitors MUST score 1-20')
  })

  it('feeds reviewer issues back and retries until quality', async () => {
    const badGrades = JSON.stringify([
      { id: 'a', score: 60, labels: { industry: 'Fleet' }, reasoning: 'ok' },
      { id: 'b', score: 62, labels: { industry: 'Healthcare' }, reasoning: 'ok' },
    ])
    const failReview = JSON.stringify({
      batch_score: 40,
      issues: ['row b: MedCo is a known competitor, must score 1-20'],
      summary: 'competitor missed',
    })
    const fixedGrades = JSON.stringify([
      { id: 'a', score: 60, labels: { industry: 'Fleet' }, reasoning: 'ok' },
      { id: 'b', score: 10, labels: { industry: 'Healthcare' }, reasoning: 'competitor' },
    ])
    const llm = new ScriptedLlm([badGrades, failReview, fixedGrades, passReview])
    const result = await gradeList(ROWS, CONFIG, llm)

    expect(result.journal[0]!.attempts).toHaveLength(2)
    expect(result.journal[0]!.accepted).toBe(true)
    expect(result.grades.find((g) => g.id === 'b')!.score).toBe(10)
    // the retry prompt carries the reviewer's issues verbatim
    expect(llm.calls[2]!.user).toContain('ISSUES FROM PREVIOUS ATTEMPT TO FIX')
    expect(llm.calls[2]!.user).toContain('known competitor')
  })

  it('rejects out-of-vocabulary labels without consulting the reviewer', async () => {
    const badVocab = JSON.stringify([
      { id: 'a', score: 80, labels: { industry: 'Trucking' }, reasoning: 'x' },
      { id: 'b', score: 70, labels: { industry: 'Healthcare' }, reasoning: 'y' },
    ])
    const llm = new ScriptedLlm([badVocab, goodGrades, passReview])
    const result = await gradeList(ROWS, CONFIG, llm)
    expect(result.journal[0]!.attempts[0]!.issues.join(' ')).toContain('not in industry vocabulary')
    expect(result.journal[0]!.accepted).toBe(true)
    expect(llm.calls).toHaveLength(3) // no reviewer call wasted on invalid output
  })

  it('parses fenced JSON (defensive parsing)', async () => {
    const fenced = '```json\n' + goodGrades + '\n```'
    const llm = new ScriptedLlm([fenced, passReview])
    const result = await gradeList(ROWS, CONFIG, llm)
    expect(result.grades).toHaveLength(2)
  })

  it('accepts last valid result after max retries, journaled as unaccepted', async () => {
    const failReview = JSON.stringify({ batch_score: 50, issues: ['weak'], summary: 'meh' })
    const llm = new ScriptedLlm([
      goodGrades, failReview,
      goodGrades, failReview,
      goodGrades, failReview,
    ])
    const result = await gradeList(ROWS, CONFIG, llm)
    expect(result.grades).toHaveLength(2)
    expect(result.journal[0]!.accepted).toBe(false)
    expect(result.journal[0]!.attempts).toHaveLength(3)
  })

  it('surfaces rows the model never graded', async () => {
    const partial = JSON.stringify([
      { id: 'a', score: 80, labels: { industry: 'Fleet' }, reasoning: 'x' },
    ])
    // missing-row problem forces retries; model keeps omitting row b
    const llm = new ScriptedLlm([partial, partial, partial])
    const result = await gradeList(ROWS, CONFIG, llm)
    expect(result.grades).toEqual([]) // incomplete batches never flow downstream
    expect(result.ungraded).toEqual(['a', 'b'])
  })

  it('rejects duplicate and invented output ids', async () => {
    const invalid = JSON.stringify([
      { id: 'a', score: 80, labels: { industry: 'Fleet' }, reasoning: 'x' },
      { id: 'a', score: 70, labels: { industry: 'Fleet' }, reasoning: 'duplicate' },
      { id: 'b', score: 60, labels: { industry: 'Other' }, reasoning: 'y' },
      { id: 'invented', score: 90, labels: { industry: 'Fleet' }, reasoning: 'z' },
    ])
    const result = await gradeList(ROWS, { ...CONFIG, maxRetries: 1 }, new ScriptedLlm([invalid]))
    expect(result.grades).toEqual([])
    expect(result.journal[0]!.attempts[0]!.issues.join(' ')).toContain('duplicate grade')
    expect(result.journal[0]!.attempts[0]!.issues.join(' ')).toContain('not present in the input')
  })

  it('processes multiple batches with progress callbacks', async () => {
    const rows: GraderRow[] = [
      ...ROWS,
      { id: 'c', fields: { name: 'ThirdCo', description: 'sensors' } },
    ]
    const thirdGrade = JSON.stringify([
      { id: 'c', score: 50, labels: { industry: 'Other' }, reasoning: 'z' },
    ])
    const llm = new ScriptedLlm([goodGrades, passReview, thirdGrade, passReview])
    const progress: number[] = []
    const result = await gradeList(rows, CONFIG, llm, (done) => {
      progress.push(done)
    })
    expect(result.grades).toHaveLength(3)
    expect(progress).toEqual([1, 2])
  })
})
