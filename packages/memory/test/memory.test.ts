import { describe, expect, it } from 'vitest'
import type { LlmClient } from '@sartre/skills'
import {
  computeGraphHealth,
  extractWikiLinks,
  ingestMeeting,
  lintInsightNode,
  parseInsightNode,
  renderGraphHealthMarkdown,
} from '../src/index.js'
import type { MemoryFile } from '../src/index.js'

const NODE = `---
client: Acme
date: 2026-07-09
status: in-progress
tags: [enrichment, clay]
source: meeting
source_file: "[[2026-07-09-kickoff]]"
related_concepts:
  - "[[icp-definition]]"
---

# Enrichment workflow design

We agreed to run waterfall enrichment through Clay [VERIFIED: 2026-07-09-kickoff].
This implies roughly 20 credits per account [INFERRED: 8 providers at listed rates].
See [[clay-credit-budget|the budget]] and [[deliverables/enrichment/architecture#design]].
`

describe('parseInsightNode + wiki links', () => {
  it('parses frontmatter, links (alias/anchor stripped), attribution counts', () => {
    const node = parseInsightNode('insights/enrichment-workflow-design.md', NODE)
    expect(node.frontmatter).toMatchObject({ client: 'Acme', status: 'in-progress', tags: ['enrichment', 'clay'] })
    expect(node.links.sort()).toEqual([
      '2026-07-09-kickoff',
      'clay-credit-budget',
      'deliverables/enrichment/architecture',
      'icp-definition',
    ])
    expect(node.attribution).toEqual({ verified: 1, inferred: 1, unverifiable: 0 })
    expect(lintInsightNode(node)).toEqual([])
  })

  it('rejects blessed-value violations and over-tagging', () => {
    const bad = NODE.replace('status: in-progress', 'status: doing-stuff')
    expect(() => parseInsightNode('insights/x.md', bad)).toThrow('frontmatter invalid')
    const overTagged = NODE.replace('tags: [enrichment, clay]', 'tags: [a, b, c, d, e, f, g, h]')
    expect(() => parseInsightNode('insights/x.md', overTagged)).toThrow()
  })

  it('lints missing attribution and meeting-note filenames', () => {
    const noAttr = parseInsightNode('insights/meeting-notes-jan.md', NODE.replace(/\[VERIFIED[^\]]*\]|\[INFERRED[^\]]*\]/g, ''))
    const problems = lintInsightNode(noAttr)
    expect(problems.some((p) => p.includes('attribution'))).toBe(true)
    expect(problems.some((p) => p.includes('CONCEPT'))).toBe(true)
  })

  it('extractWikiLinks dedupes', () => {
    expect(extractWikiLinks('[[a]] [[a|x]] [[a#y]]')).toEqual(['a'])
  })
})

describe('computeGraphHealth', () => {
  const files: MemoryFile[] = [
    { path: 'insights/enrichment-workflow-design.md', content: NODE, lastTouched: '2026-05-01T00:00:00Z' }, // stale in-progress
    {
      path: 'insights/icp-definition.md',
      content: NODE.replace('status: in-progress', 'status: completed').replace('# Enrichment workflow design', '# ICP definition'),
      lastTouched: '2026-07-08T00:00:00Z',
    },
    {
      path: 'insights/orphan-idea.md',
      content: `---\nclient: Acme\ndate: 2026-07-09\nstatus: backlog\ntags: [signals]\nsource: brainstorm\nrelated_concepts: []\n---\n\nAn unlinked idea about signal scans [UNVERIFIABLE]. ${'x'.repeat(80)}\n`,
    },
    { path: 'insights/broken.md', content: 'not even frontmatter' },
    { path: 'meetings/external/2026-07-09-kickoff.md', content: '---\nx: 1\n---\nlinks to [[icp-definition]]' },
    { path: '_synthesis/engagement-summary.md', content: 'summary linking [[enrichment-workflow-design]]' },
  ]

  it('computes counts, link health, staleness, invalid nodes, rating', () => {
    const report = computeGraphHealth(files, { now: new Date('2026-07-09T00:00:00Z'), validatedTags: ['clay'] })
    expect(report.counts).toMatchObject({ insights: 3, meetings: 1, synthesis: 1, invalidNodes: 1 })
    expect(report.byStatus).toEqual({ 'in-progress': 1, completed: 1, backlog: 1 })
    expect(report.linkHealth.orphans).toEqual(['insights/orphan-idea.md'])
    // forward refs: clay-credit-budget + deliverables path don't exist (×2 nodes using NODE body)
    expect(report.linkHealth.forwardRefs.length).toBeGreaterThan(0)
    expect(report.staleInProgress).toEqual(['insights/enrichment-workflow-design.md'])
    expect(report.invalid[0]!.path).toBe('insights/broken.md')
    expect(report.rating).toBe('Warning')
  })

  it('healthy instance rates Healthy and renders markdown', () => {
    const healthy: MemoryFile[] = [
      { path: 'insights/icp-definition.md', content: files[1]!.content, lastTouched: '2026-07-08T00:00:00Z' },
      { path: 'meetings/external/2026-07-09-kickoff.md', content: 'refs [[icp-definition]] [[icp-definition]]' },
      { path: '_synthesis/engagement-summary.md', content: 'links [[icp-definition]] too' },
    ]
    const report = computeGraphHealth(healthy, { now: new Date('2026-07-09T00:00:00Z') })
    expect(report.rating).toBe('Healthy')
    const md = renderGraphHealthMarkdown('Acme', report)
    expect(md).toContain('rating: **Healthy**')
    expect(md).toContain('Insights: 1')
  })

  it('empty synthesis on a 10+ insight instance is a gap', () => {
    const many: MemoryFile[] = Array.from({ length: 10 }, (_, i) => ({
      path: `insights/concept-${i}.md`,
      content: files[2]!.content,
    }))
    const report = computeGraphHealth(many, { now: new Date('2026-07-09T00:00:00Z') })
    expect(report.synthesisGaps.some((g) => g.includes('no synthesis doc'))).toBe(true)
    expect(report.synthesisGaps.some((g) => g.includes('engagement-summary'))).toBe(true)
  })
})

describe('ingestMeeting', () => {
  class ScriptedLlm implements LlmClient {
    calls: { system: string; user: string }[] = []
    constructor(private responses: string[]) {}
    async complete(req: { system: string; user: string }): Promise<string> {
      this.calls.push(req)
      const next = this.responses.shift()
      if (next === undefined) throw new Error('fake exhausted')
      return next
    }
  }

  const meta = {
    clientName: 'Acme',
    date: '2026-07-09',
    topic: 'kickoff-sync',
    participants: ['Sean', 'Jane (Acme)'],
    kind: 'external' as const,
  }

  const goodAnalysis = JSON.stringify({
    summary: 'Kickoff covered enrichment scope, credit budget, and the first campaign target list for Q3.',
    decisions: ['Waterfall enrichment via Clay'],
    teamTodos: [{ owner: 'Sean', todo: 'draft credit budget' }],
    clientTodos: ['share Salesforce export'],
    insights: [
      {
        slug: 'clay-credit-budget-constraints',
        tags: ['clay', 'budget'],
        status: 'active',
        body: `## Key Points\n\nAcme caps enrichment at 700k credits [VERIFIED: 2026-07-09-kickoff-sync].\n\n## Evidence\n\n> "we have about 700k credits for the year" — Jane [VERIFIED: 2026-07-09-kickoff-sync]\n`,
      },
    ],
  })

  it('produces a meeting file + validated insight nodes with deterministic frontmatter', async () => {
    const llm = new ScriptedLlm([goodAnalysis])
    const result = await ingestMeeting('Jane: we have about 700k credits for the year...', meta, llm)

    expect(result.meetingFile.path).toBe('meetings/external/2026-07-09-kickoff-sync.md')
    expect(result.meetingFile.markdown).toContain('## Team To-Dos')
    expect(result.meetingFile.markdown).toContain('- [ ] Sean: draft credit budget')
    expect(result.meetingFile.markdown).toContain('[[clay-credit-budget-constraints]]')

    expect(result.insightFiles).toHaveLength(1)
    const node = parseInsightNode(result.insightFiles[0]!.path, result.insightFiles[0]!.markdown)
    expect(node.frontmatter).toMatchObject({
      client: 'Acme',
      source: 'meeting',
      source_file: '[[2026-07-09-kickoff-sync]]',
    })
    expect(node.attribution.verified).toBe(2)
  })

  it('retries with validation problems fed back (bad slug, thin body)', async () => {
    const bad = JSON.stringify({
      ...JSON.parse(goodAnalysis),
      insights: [{ slug: 'Meeting Notes!', tags: [], status: 'active', body: 'short' }],
    })
    const llm = new ScriptedLlm([bad, goodAnalysis])
    const result = await ingestMeeting('transcript', meta, llm)
    expect(result.insightFiles).toHaveLength(1)
    expect(llm.calls[1]!.user).toContain('PREVIOUS ATTEMPT FAILED VALIDATION')
  })

  it('throws after exhausting retries', async () => {
    const noAttr = JSON.stringify({
      ...JSON.parse(goodAnalysis),
      insights: [{ slug: 'valid-slug-here', tags: ['x'], status: 'active', body: 'A body with no attribution tags at all. '.repeat(4) }],
    })
    const llm = new ScriptedLlm([noAttr, noAttr, noAttr])
    await expect(ingestMeeting('transcript', meta, llm)).rejects.toThrow('attribution')
  })
})
