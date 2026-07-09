import { revalidatePath } from 'next/cache'
import { notFound } from 'next/navigation'
import { decideGate, getManifest, listPendingGates } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'

export default async function ReviewQueue({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()
  const pending = await listPendingGates(clientId)

  async function decide(formData: FormData) {
    'use server'
    const decision = formData.get('decision') as 'approved' | 'rejected'
    const actor = String(formData.get('actor') ?? '').trim()
    if (!actor) throw new Error('reviewer name required — approvals must be attributed')
    const reason = String(formData.get('reason') ?? '').trim() || undefined
    await decideGate(
      clientId,
      String(formData.get('runId')),
      String(formData.get('gateId')),
      decision,
      actor,
      reason,
    )
    revalidatePath(`/clients/${encodeURIComponent(clientId)}/review`)
  }

  return (
    <>
      <ClientTabs clientId={clientId} active="review" />
      <h1>Review queue</h1>
      {pending.length === 0 ? (
        <div className="card muted">Nothing waiting for approval.</div>
      ) : (
        pending.map((item) => (
          <div className="card" key={`${item.run.runId}:${item.gateId}`}>
            <div>
              <span className="pill yellow">{item.outputClass}</span>{' '}
              <span className="mono">{item.run.pipelineId}</span>{' '}
              <span className="muted">
                step {item.step} · run <span className="mono">{item.run.runId.slice(0, 8)}</span> ·{' '}
                {new Date(item.run.updatedAt).toLocaleString()}
              </span>
            </div>
            <pre className="payload">{JSON.stringify(item.payload, null, 2)}</pre>
            <form action={decide} className="actions">
              <input type="hidden" name="runId" value={item.run.runId} />
              <input type="hidden" name="gateId" value={item.gateId} />
              <input type="text" name="actor" placeholder="your name (required)" required />
              <input type="text" name="reason" placeholder="reason (optional, feeds learning)" />
              <button className="approve" name="decision" value="approved" type="submit">
                Approve
              </button>
              <button className="reject" name="decision" value="rejected" type="submit">
                Reject
              </button>
            </form>
          </div>
        ))
      )}
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        Every decision here is captured as a feedback event (Layer 8). Rejections with a reason become
        exemplars; edit-then-approve lands in a later version of this queue.
      </p>
    </>
  )
}
