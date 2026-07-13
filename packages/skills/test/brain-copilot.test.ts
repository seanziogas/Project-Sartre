import { describe, expect, it } from 'vitest'
import { answerBrainQuestion } from '../src/brain-copilot.js'

const input = {
  question: 'Who is the ideal customer?',
  allowedSources: ['icp.md'],
  brainContext: '=== icp.md ===\nPrimary segment: North American fleet operators with more than 500 vehicles.',
}

describe('Brain copilot known-answer eval', () => {
  it('returns a grounded answer with exact approved-context evidence', async () => {
    const answer = await answerBrainQuestion(input, {
      complete: async () => JSON.stringify({
        answer: 'The primary segment is North American fleet operators with more than 500 vehicles.',
        citations: [{ source: 'icp.md', evidence: 'North American fleet operators with more than 500 vehicles' }],
        limitations: [],
      }),
    })
    expect(answer.answer).toContain('fleet operators')
    expect(answer.citations[0]!.source).toBe('icp.md')
  })

  it('rejects invented evidence and unapproved sources', async () => {
    await expect(answerBrainQuestion(input, {
      complete: async () => JSON.stringify({
        answer: 'Enterprise banks.',
        citations: [{ source: 'secret.md', evidence: 'Enterprise banks' }],
        limitations: [],
      }),
    })).rejects.toThrow('unapproved source')
    await expect(answerBrainQuestion(input, {
      complete: async () => JSON.stringify({
        answer: 'Enterprise banks.',
        citations: [{ source: 'icp.md', evidence: 'Enterprise banks' }],
        limitations: [],
      }),
    })).rejects.toThrow('not present')
  })

  it('rejects evidence borrowed from a different approved document', async () => {
    await expect(answerBrainQuestion({
      ...input,
      allowedSources: ['icp.md', 'voice.md'],
      brainContext: `${input.brainContext}\n\n=== voice.md ===\nUse a direct and practical tone.`,
    }, {
      complete: async () => JSON.stringify({
        answer: 'Use a direct tone.',
        citations: [{ source: 'icp.md', evidence: 'Use a direct and practical tone.' }],
        limitations: [],
      }),
    })).rejects.toThrow('not present')
  })
})
