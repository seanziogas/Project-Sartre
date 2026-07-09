import Link from 'next/link'
import { listClients } from '@/lib/data'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const clients = await listClients()
  return (
    <>
      <h1>Clients</h1>
      {clients.length === 0 ? (
        <div className="card muted">
          No client instances found. Copy <span className="mono">clients/_template/</span> to{' '}
          <span className="mono">clients/&lt;Client Name&gt;/</span> during Onboarding Week.
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Client</th>
              <th>Status</th>
              <th>Modules enabled</th>
            </tr>
          </thead>
          <tbody>
            {clients.map((c) => (
              <tr key={c.id}>
                <td>
                  <Link href={`/clients/${encodeURIComponent(c.id)}`}>{c.name}</Link>
                </td>
                <td>
                  <span className={`pill ${c.status === 'active' ? 'green' : 'gray'}`}>{c.status}</span>
                </td>
                <td>{c.modulesEnabled}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
