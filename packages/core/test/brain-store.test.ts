import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ClientBrainError, FileClientBrainStore } from '../src/index.js'

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'sartre-brain-'))
  temporaryRoots.push(root)
  const brain = join(root, 'Acme', 'brain')
  await mkdir(join(brain, 'config'), { recursive: true })
  return { root, brain, store: new FileClientBrainStore(root) }
}

describe('FileClientBrainStore', () => {
  it('loads only active, attributed brain context', async () => {
    const { brain, store } = await fixture()
    await writeFile(join(brain, 'grading.md'), [
      '---',
      'brain_doc: grading',
      'client: Acme',
      'status: active',
      'updated: 2026-07-13',
      'sources: []',
      'approved_by: gtme@kiln',
      'posture: strict',
      '---',
      '# Rules',
      'Competitors are disqualified.',
    ].join('\n'))

    const context = await store.loadContext('Acme', ['grading.md'])
    expect(context).toContain('=== grading.md ===')
    expect(context).toContain('Competitors are disqualified.')
  })

  it('rejects drafts and paths outside the client brain', async () => {
    const { root, brain, store } = await fixture()
    await writeFile(join(brain, 'routing.md'), [
      '---',
      'brain_doc: routing',
      'client: Acme',
      'status: draft',
      'updated: 2026-07-13',
      'sources: []',
      'approved_by: ""',
      '---',
      'draft',
    ].join('\n'))

    await expect(store.loadApprovedDoc('Acme', 'routing.md')).rejects.toThrow('not approved for machine use')
    await expect(store.loadApprovedDoc('Acme', '../../Other/brain/grading.md')).rejects.toBeInstanceOf(ClientBrainError)
    await expect(store.loadApprovedDoc('../Other', 'grading.md')).rejects.toBeInstanceOf(ClientBrainError)

    const outside = join(root, 'outside.md')
    await writeFile(outside, 'outside the client boundary')
    await symlink(outside, join(brain, 'escape.md'))
    await expect(store.loadApprovedDoc('Acme', 'escape.md')).rejects.toThrow('escapes the client boundary')
  })

  it('validates typed config only after its human approval gate', async () => {
    const { brain, store } = await fixture()
    await writeFile(join(brain, 'config', 'routing.yaml'), [
      'version: 1',
      'status: active',
      'updated: 2026-07-13',
      'approved_by: gtme@kiln',
      'config:',
      '  default_owner: AE West',
      '  threshold: 100000000',
    ].join('\n'))
    const schema = z.object({ default_owner: z.string(), threshold: z.number().positive() })

    await expect(store.loadApprovedConfig('Acme', 'routing.yaml', schema)).resolves.toEqual({
      default_owner: 'AE West',
      threshold: 100000000,
    })

    await writeFile(join(brain, 'config', 'routing.yaml'), [
      'version: 1',
      'status: draft',
      'updated: 2026-07-13',
      'approved_by: ""',
      'config: {}',
    ].join('\n'))
    await expect(store.loadApprovedConfig('Acme', 'routing.yaml', schema)).rejects.toThrow('not active and human-approved')
  })
})
