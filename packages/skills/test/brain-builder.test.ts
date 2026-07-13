import { describe, expect, it } from 'vitest'
import { buildBrain } from '../src/brain-builder.js'
import type { BrainSource } from '../src/brain-builder.js'
import type { LlmClient } from '../src/llm.js'

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

const SOURCES: BrainSource[] = [
  { kind: 'website', label: 'acme-website', text: 'Acme sells IoT connectivity.' },
  { kind: 'transcript', label: '2026-07-01-kickoff', text: 'We target fleet companies.' },
]

const body = 'Grounded content [VERIFIED: acme-website]. Interview context [VERIFIED: 2026-07-01-kickoff]. '.repeat(3)

function doc(docType: string, extra = ''): string {
  return `---
brain_doc: ${docType}
client: Acme
status: draft
updated: 2026-07-09
sources: [acme-website, 2026-07-01-kickoff]
approved_by: ""
${extra}---

# ${docType}

${body}
`
}

// buildBrain drafts 5 docs in order: company, icp, voice, grading, use-cases
const GOOD = [
  doc('company'),
  doc('icp'),
  doc('voice'),
  doc('grading', 'posture: generous\n'),
  doc('use-cases', 'vocabulary: [fleet, healthcare]\n'),
]

describe('buildBrain — eval set', () => {
  it('drafts the full v1 build set with valid frontmatter', async () => {
    const llm = new ScriptedLlm([...GOOD])
    const result = await buildBrain('Acme', SOURCES, llm, { today: '2026-07-09' })
    expect(result.failed).toEqual([])
    expect(result.drafts.map((d) => d.file)).toEqual([
      'company.md', 'icp.md', 'voice.md', 'grading.md', 'use-cases.md',
    ])
    expect(result.drafts.every((d) => d.frontmatter.status === 'draft')).toBe(true)
    // sources reach the model with attribution labels
    expect(llm.calls[0]!.user).toContain('SOURCE [transcript] 2026-07-01-kickoff')
    expect(llm.calls[0]!.system).toContain('[VERIFIED: <source label>]')
  })

  it('retries with validation problems fed back', async () => {
    const wrongType = doc('icp') // returned when company.md was requested
    const llm = new ScriptedLlm([wrongType, doc('company'), ...GOOD.slice(1)])
    const result = await buildBrain('Acme', SOURCES, llm, { today: '2026-07-09' })
    expect(result.failed).toEqual([])
    expect(llm.calls[1]!.user).toContain('PREVIOUS ATTEMPT FAILED VALIDATION')
    expect(llm.calls[1]!.user).toContain('brain_doc must be "company"')
  })

  it('refuses drafts that claim to be active (human gate is structural)', async () => {
    const active = doc('company').replace('status: draft', 'status: active')
    const llm = new ScriptedLlm([active, active, active, ...GOOD.slice(1)])
    const result = await buildBrain('Acme', SOURCES, llm, { today: '2026-07-09' })
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0]!.docType).toBe('company')
    expect(result.failed[0]!.problems.join(' ')).toContain('human approval')
  })

  it('rejects implausibly thin bodies', async () => {
    const thin = `---\nbrain_doc: company\nclient: Acme\nstatus: draft\nupdated: 2026-07-09\nsources: []\napproved_by: ""\n---\n\nshort`
    const llm = new ScriptedLlm([thin, doc('company'), ...GOOD.slice(1)])
    const result = await buildBrain('Acme', SOURCES, llm, { today: '2026-07-09' })
    expect(result.failed).toEqual([])
    expect(llm.calls[1]!.user).toContain('implausibly short')
  })

  it('rejects drafts that cite sources not supplied to the build', async () => {
    const ungrounded = doc('company').replaceAll('acme-website', 'invented-source')
    const llm = new ScriptedLlm([ungrounded, ungrounded, ungrounded, ...GOOD.slice(1)])
    const result = await buildBrain('Acme', SOURCES, llm, { today: '2026-07-09' })
    expect(result.failed[0]!.problems.join(' ')).toContain('was not provided')
    expect(result.failed[0]!.problems.join(' ')).toContain('unknown source')
  })
})
