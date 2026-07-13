import { describe, expect, it } from 'vitest'
import { generateCopilotBrief } from '../src/copilot-brief.js'
import type { CopilotBriefInput } from '../src/copilot-brief.js'
import type { LlmClient } from '../src/llm.js'

class ScriptedLlm implements LlmClient {
  calls: { system: string; user: string }[] = []
  constructor(private readonly responses: string[]) {}
  async complete(req: { system: string; user: string }): Promise<string> {
    this.calls.push(req)
    const response = this.responses.shift()
    if (response === undefined) throw new Error('scripted LLM exhausted')
    return response
  }
}

const INPUT: CopilotBriefInput = {
  accountId: 'account-1',
  accountName: 'Acme Fleet',
  generatedAt: '2026-07-13T12:00:00.000Z',
  brainContext: 'ICP: fleet operators. Voice: practical. Never claim guaranteed savings.',
  evidence: [
    { id: 'account:account-1', kind: 'account', observedAt: '2026-07-01T00:00:00Z', content: 'Acme Fleet operates in logistics.' },
    { id: 'opportunity:opp-1', kind: 'opportunity', observedAt: '2026-07-10T00:00:00Z', content: 'Expansion opportunity is open at $250,000.' },
    { id: 'activity:meeting-1', kind: 'activity', observedAt: '2026-07-12T00:00:00Z', content: 'Buyer asked about deployment timing.' },
  ],
}

function brief(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    status: 'draft',
    accountId: INPUT.accountId,
    generatedAt: INPUT.generatedAt,
    title: 'Acme Fleet meeting brief',
    executiveSummary: [{ text: 'Acme is evaluating expansion.', sourceRefs: ['opportunity:opp-1'] }],
    recentSignals: [{ text: 'The buyer asked about timing.', sourceRefs: ['activity:meeting-1'] }],
    openOpportunities: [{ text: 'Expansion is valued at $250,000.', sourceRefs: ['opportunity:opp-1'] }],
    risks: [],
    recommendedActions: [{ text: 'Clarify the deployment timeline.', sourceRefs: ['activity:meeting-1'] }],
    questionsForTheMeeting: [{ text: 'What timing constraint matters most?', sourceRefs: ['activity:meeting-1'] }],
    ...overrides,
  })
}

describe('copilot brief — known-answer eval set', () => {
  it('returns a validated grounded draft and includes the approved brain', async () => {
    const llm = new ScriptedLlm([brief()])
    const result = await generateCopilotBrief(INPUT, llm)

    expect(result).toMatchObject({ status: 'draft', accountId: 'account-1' })
    expect(llm.calls[0]!.system).toContain('Never claim guaranteed savings')
    expect(llm.calls[0]!.user).toContain('opportunity:opp-1')
  })

  it('retries unknown citations with exact validation feedback', async () => {
    const llm = new ScriptedLlm([
      brief({ executiveSummary: [{ text: 'Invented claim.', sourceRefs: ['invented-source'] }] }),
      brief(),
    ])
    const result = await generateCopilotBrief(INPUT, llm)

    expect(result.status).toBe('draft')
    expect(llm.calls[1]!.user).toContain('unknown evidence sourceRef: invented-source')
  })

  it('never accepts a model-produced approved brief', async () => {
    const active = brief({ status: 'approved' })
    const llm = new ScriptedLlm([active, active])

    await expect(generateCopilotBrief(INPUT, llm, { maxRetries: 1 }))
      .rejects.toThrow('status: Invalid literal value')
  })

  it('rejects missing Brain context before calling the model', async () => {
    const llm = new ScriptedLlm([brief()])
    await expect(generateCopilotBrief({ ...INPUT, brainContext: '' }, llm)).rejects.toThrow()
    expect(llm.calls).toHaveLength(0)
  })
})
