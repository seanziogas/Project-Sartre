import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { BrainDocError, parseBrainDoc, validateBrainDocRules } from '../src/brain/frontmatter.js'

const brainDir = resolve(import.meta.dirname, '../../../clients/_template/brain')

describe('parseBrainDoc', () => {
  it('parses every stub in the instance template', () => {
    const files = readdirSync(brainDir).filter((f) => f.endsWith('.md'))
    expect(files.length).toBeGreaterThanOrEqual(9)
    for (const f of files) {
      const { frontmatter } = parseBrainDoc(readFileSync(resolve(brainDir, f), 'utf8'))
      expect(frontmatter.status).toBe('draft') // template ships drafts
    }
  })

  it('rejects a doc without frontmatter', () => {
    expect(() => parseBrainDoc('# Just a heading\n')).toThrow(BrainDocError)
  })

  it('rejects unknown brain_doc types', () => {
    const doc = `---\nbrain_doc: vibes\nclient: X\nstatus: draft\nupdated: 2026-07-09\n---\nbody`
    expect(() => parseBrainDoc(doc)).toThrow(BrainDocError)
  })
})

describe('validateBrainDocRules', () => {
  const baseFm = parseBrainDoc(
    `---\nbrain_doc: grading\nclient: X\nstatus: draft\nupdated: 2026-07-09\napproved_by: ""\n---\nbody`,
  ).frontmatter

  it('active grading doc must declare posture', () => {
    const problems = validateBrainDocRules({ ...baseFm, status: 'active', approved_by: 'GTME' })
    expect(problems.some((p) => p.includes('posture'))).toBe(true)
  })

  it('active docs must be approved and dated', () => {
    const problems = validateBrainDocRules({ ...baseFm, status: 'active', updated: 'YYYY-MM-DD' })
    expect(problems.some((p) => p.includes('approved_by'))).toBe(true)
    expect(problems.some((p) => p.includes('real updated date'))).toBe(true)
  })

  it('drafts are exempt', () => {
    expect(validateBrainDocRules(baseFm)).toEqual([])
  })
})
