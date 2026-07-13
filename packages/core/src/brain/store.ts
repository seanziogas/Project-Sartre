import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'
import { parseBrainDoc, validateBrainDocRules } from './frontmatter.js'
import type { BrainFrontmatter } from './frontmatter.js'

export interface ApprovedBrainDoc {
  path: string
  frontmatter: BrainFrontmatter
  body: string
}

const ConfigEnvelope = z.object({
  version: z.literal(1),
  status: z.enum(['active', 'draft', 'superseded']),
  updated: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  approved_by: z.string(),
  config: z.unknown(),
})

export class ClientBrainError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ClientBrainError'
  }
}

/**
 * Filesystem boundary for git-backed client brains. Machine consumers can
 * read active, human-approved documents and typed config envelopes only.
 */
export class FileClientBrainStore {
  private readonly root: string

  constructor(clientsDir: string) {
    this.root = resolve(clientsDir)
  }

  async loadApprovedDoc(clientId: string, brainPath: string): Promise<ApprovedBrainDoc> {
    const path = await this.safePath(clientId, brainPath)
    let markdown: string
    try {
      markdown = await readFile(path, 'utf8')
    } catch (error) {
      throw new ClientBrainError(`${clientId}/brain/${brainPath} unreadable: ${(error as Error).message}`)
    }
    const parsed = parseBrainDoc(markdown)
    const problems = validateBrainDocRules(parsed.frontmatter)
    if (parsed.frontmatter.status !== 'active') problems.unshift(`brain doc status is ${parsed.frontmatter.status}, not active`)
    if (problems.length > 0) {
      throw new ClientBrainError(`${clientId}/brain/${brainPath} is not approved for machine use: ${problems.join('; ')}`)
    }
    return { path: brainPath, ...parsed }
  }

  async loadContext(clientId: string, brainPaths: string[]): Promise<string> {
    const docs = await Promise.all(brainPaths.map((path) => this.loadApprovedDoc(clientId, path)))
    return docs.map((doc) => `=== ${doc.path} ===\n${doc.body.trim()}`).join('\n\n')
  }

  /** Config files live under brain/config and carry their own human gate. */
  async loadApprovedConfig<T>(clientId: string, fileName: string, schema: z.ZodType<T>): Promise<T> {
    const brainPath = `config/${fileName}`
    const path = await this.safePath(clientId, fileName, 'config')
    let raw: unknown
    try {
      raw = parseYaml(await readFile(path, 'utf8'))
    } catch (error) {
      throw new ClientBrainError(`${clientId}/brain/${brainPath} unreadable: ${(error as Error).message}`)
    }
    const envelope = ConfigEnvelope.safeParse(raw)
    if (!envelope.success) {
      throw new ClientBrainError(`${clientId}/brain/${brainPath} has an invalid config envelope`)
    }
    if (envelope.data.status !== 'active' || envelope.data.approved_by.trim() === '') {
      throw new ClientBrainError(`${clientId}/brain/${brainPath} is not active and human-approved`)
    }
    const config = schema.safeParse(envelope.data.config)
    if (!config.success) {
      const issues = config.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      throw new ClientBrainError(`${clientId}/brain/${brainPath} config failed validation: ${issues.join('; ')}`)
    }
    return config.data
  }

  private async safePath(clientId: string, brainPath: string, subdirectory = ''): Promise<string> {
    const clientRoot = resolve(this.root, clientId)
    if (!isWithin(this.root, clientRoot)) throw new ClientBrainError(`invalid client id: ${clientId}`)
    const brainRoot = resolve(clientRoot, 'brain')
    const allowedRoot = resolve(brainRoot, subdirectory)
    const path = resolve(allowedRoot, brainPath)
    if (!brainPath || !isWithin(allowedRoot, path)) {
      throw new ClientBrainError(`invalid brain path: ${brainPath}`)
    }
    try {
      const [realRoot, realClient, realBrain, realAllowed, realPath] = await Promise.all([
        realpath(this.root),
        realpath(clientRoot),
        realpath(brainRoot),
        realpath(allowedRoot),
        realpath(path),
      ])
      if (!isWithin(realRoot, realClient)
        || !isWithin(realClient, realBrain)
        || (subdirectory !== '' && !isWithin(realBrain, realAllowed))
        || !isWithin(realAllowed, realPath)) {
        throw new ClientBrainError(`brain path escapes the client boundary: ${brainPath}`)
      }
      return realPath
    } catch (error) {
      if (error instanceof ClientBrainError) throw error
      throw new ClientBrainError(`${clientId}/brain/${subdirectory ? `${subdirectory}/` : ''}${brainPath} unreadable: ${(error as Error).message}`)
    }
  }
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}
