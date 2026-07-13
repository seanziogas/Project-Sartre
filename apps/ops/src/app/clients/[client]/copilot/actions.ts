'use server'

import { resolve } from 'node:path'
import { FileClientBrainStore } from '@sartre/core'
import { AnthropicLlmClient, brainCopilot } from '@sartre/skills'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { getManifest } from '@/lib/data'

export interface CopilotState {
  answer?: brainCopilot.BrainCopilotAnswer
  error?: string
}

const BRAIN_DOCS = ['company.md', 'icp.md', 'voice.md', 'use-cases.md', 'grading.md', 'routing.md', 'signals.md']

export async function askCopilotAction(
  clientId: string,
  _previous: CopilotState,
  formData: FormData,
): Promise<CopilotState> {
  try {
    const identity = await getPortalIdentity()
    assertClientAccess(identity, clientId, 'copilot')
    const manifest = await getManifest(clientId)
    if (!manifest) throw new Error('client not found')
    if (!['trialing', 'active'].includes(manifest.commercial.status)) {
      throw new Error('subscription status does not include copilot access')
    }
    const question = String(formData.get('question') ?? '').trim()
    const clientsDir = resolve(process.env.SARTRE_CLIENTS_DIR ?? resolve(process.cwd(), '../../clients'))
    const brains = new FileClientBrainStore(clientsDir)
    const approved = []
    for (const path of BRAIN_DOCS) {
      try {
        approved.push(await brains.loadApprovedDoc(clientId, path))
      } catch {
        // Draft/missing docs are intentionally unavailable to the copilot.
      }
    }
    if (approved.length === 0) throw new Error('no active, human-approved Brain documents are available')
    const brainContext = approved.map((doc) => `=== ${doc.path} ===\n${doc.body.trim()}`).join('\n\n')
    const answer = await brainCopilot.answerBrainQuestion({
      question,
      brainContext,
      allowedSources: approved.map((doc) => doc.path),
    }, new AnthropicLlmClient('claude-opus-4-8'))
    return { answer }
  } catch (error) {
    console.error('Brain copilot request failed', error)
    return { error: 'The copilot could not produce a grounded answer. Verify approved Brain documents and try again.' }
  }
}
