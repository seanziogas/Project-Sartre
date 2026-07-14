import { notFound } from 'next/navigation'
import { assertClientAccess, getPortalIdentity } from '@/lib/auth'
import { getManifest, getOperationsDashboard } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'

export default async function OperationsPage({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const identity = await getPortalIdentity()
  assertClientAccess(identity, clientId, 'view')
  if (!(await getManifest(clientId))) notFound()
  const slos = await getOperationsDashboard(clientId)
  return <>
    <ClientTabs clientId={clientId} active="operations" />
    <h1>Operations and SLOs</h1>
    <div className="grid">
      {slos.map((slo) => <div className="stat" key={slo.id}>
        <div className="label">{slo.name}</div>
        <div className="value">{(slo.value * 100).toFixed(1)}%</div>
        <span className={`pill ${slo.passing ? 'green' : 'red'}`}>{slo.passing ? 'within SLO' : 'breached'}</span>
        <div className="muted">Target {(slo.target * 100).toFixed(1)}% · {slo.windowHours}h window</div>
        <div className="muted">{slo.detail}</div>
      </div>)}
    </div>
    <p className="muted">Runner traces and metrics export through OTLP/HTTP when the deployment configures an OpenTelemetry collector.</p>
  </>
}
