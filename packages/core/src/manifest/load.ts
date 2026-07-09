import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { parseManifest, ManifestError } from './manifest.js'
import type { ClientManifest } from './manifest.js'

/**
 * Load every client manifest under a clients/ directory (the git-backed
 * instance layout). Directories starting with `_` or `.` are skipped
 * (templates, scratch). Invalid manifests are reported, not thrown — one
 * broken client must not take down the runner.
 */
export async function loadManifestsFromDir(
  clientsDir: string,
): Promise<{ manifests: Map<string, ClientManifest>; problems: { clientId: string; error: string }[] }> {
  const manifests = new Map<string, ClientManifest>()
  const problems: { clientId: string; error: string }[] = []

  let entries
  try {
    entries = await readdir(clientsDir, { withFileTypes: true })
  } catch (err) {
    return { manifests, problems: [{ clientId: '(dir)', error: (err as Error).message }] }
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('_') || entry.name.startsWith('.')) continue
    const clientId = entry.name
    try {
      const yaml = await readFile(join(clientsDir, clientId, 'client.yaml'), 'utf8')
      manifests.set(clientId, parseManifest(yaml))
    } catch (err) {
      problems.push({
        clientId,
        error: err instanceof ManifestError ? err.message : `client.yaml unreadable: ${(err as Error).message}`,
      })
    }
  }
  return { manifests, problems }
}
