import { describe, expect, it } from 'vitest'
import { evaluateOptimizationDraft, evaluateTuningProposal } from '../src/index.js'

describe('built-in learning proposal evals', () => {
  it('passes evidence-complete tuning proposals and rejects unsafe or thin proposals', () => {
    const eventIds = Array.from({ length: 8 }, (_, index) => `event-${index}`)
    const valid = { kind: 'grading_bias' as const, target: 'brain/grading.md', summary: 'Review posture', proposedChange: 'Review the floor rules.', evidence: { eventIds, sampleSize: 8, detail: 'mean shift +12' } }
    expect(evaluateTuningProposal(valid)).toMatchObject({ pass: true })
    expect(evaluateTuningProposal({ ...valid, target: 'brain/company.md' })).toMatchObject({ pass: false })
    expect(evaluateTuningProposal({ ...valid, proposedChange: 'status: active\nauto-apply this' })).toMatchObject({ pass: false })
    expect(evaluateTuningProposal({ ...valid, evidence: { ...valid.evidence, sampleSize: 2 } })).toMatchObject({ pass: false })
  })

  it('requires optimization drafts to remain cited, reviewable, and inactive', () => {
    const valid = {
      kind: 'allocation_report', slug: 'outcome-allocation-2026-07-14', target: 'brain/learned/outcome-allocation-2026-07-14.md',
      content: '---\nstatus: draft\nsources: ["outcome-event:event-1"]\napproved_by: ""\n---\n\nReview only.', sourceEventIds: ['event-1'],
    }
    expect(evaluateOptimizationDraft(valid)).toMatchObject({ pass: true })
    expect(evaluateOptimizationDraft({ ...valid, content: valid.content.replace('status: draft', 'status: active') })).toMatchObject({ pass: false })
    expect(evaluateOptimizationDraft({ ...valid, sourceEventIds: ['uncited'] })).toMatchObject({ pass: false })
  })
})
