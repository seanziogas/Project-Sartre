import { notFound } from 'next/navigation'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { getManifest } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'
import { CopilotForm } from './CopilotForm'

export const dynamic = 'force-dynamic'

export default async function Copilot({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'copilot')
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()
  return (
    <>
      <ClientTabs clientId={clientId} active="copilot" showCopilot />
      <h1>Brain copilot</h1>
      <p className="muted">Read-only answers from active, human-approved Brain documents. Citations are validated against exact source text.</p>
      <CopilotForm clientId={clientId} />
    </>
  )
}
