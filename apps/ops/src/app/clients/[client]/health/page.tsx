import { notFound } from 'next/navigation'
import { getHealthReport, getManifest } from '@/lib/data'
import { ClientTabs } from '@/lib/nav'

export const dynamic = 'force-dynamic'

export default async function Health({ params }: { params: Promise<{ client: string }> }) {
  const clientId = decodeURIComponent((await params).client)
  const manifest = await getManifest(clientId)
  if (!manifest) notFound()
  const report = await getHealthReport(clientId)

  return (
    <>
      <ClientTabs clientId={clientId} active="health" />
      <h1>Data health</h1>
      {!report ? (
        <div className="card muted">
          No Data Health Report yet — run the Day-1 Data Audit. The audit writes{' '}
          <span className="mono">health-report.json</span> into this client&apos;s data directory.
        </div>
      ) : (
        <>
          <div className="grid">
            <div className="stat">
              <div className="label">Health score</div>
              <div className="value">{report.score}/100</div>
            </div>
            <div className="stat">
              <div className="label">Accounts</div>
              <div className="value">{report.counts.accounts.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="label">Contacts</div>
              <div className="value">{report.counts.contacts.toLocaleString()}</div>
            </div>
            <div className="stat">
              <div className="label">Orphan contacts</div>
              <div className="value">{report.orphanContacts.toLocaleString()}</div>
            </div>
          </div>

          <h2>Score components</h2>
          <table>
            <thead>
              <tr>
                <th>Component</th>
                <th>Weight</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {report.scoreBreakdown.map((c) => (
                <tr key={c.component}>
                  <td className="mono">{c.component}</td>
                  <td>{Math.round(c.weight * 100)}%</td>
                  <td>{Math.round(c.value * 100)}%</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Identifier coverage</h2>
          <table>
            <tbody>
              <tr>
                <td>Account domain</td>
                <td>{Math.round(report.identifierCoverage.accountDomain * 100)}%</td>
                <td className="muted">{report.identifierCoverage.invalidAccountDomains} junk values</td>
              </tr>
              <tr>
                <td>Contact email</td>
                <td>{Math.round(report.identifierCoverage.contactEmail * 100)}%</td>
                <td className="muted">{report.identifierCoverage.invalidContactEmails} junk values</td>
              </tr>
              <tr>
                <td>Account LinkedIn</td>
                <td>{Math.round(report.identifierCoverage.accountLinkedin * 100)}%</td>
                <td />
              </tr>
              <tr>
                <td>Contact LinkedIn</td>
                <td>{Math.round(report.identifierCoverage.contactLinkedin * 100)}%</td>
                <td />
              </tr>
            </tbody>
          </table>

          <h2>Duplicates & staleness</h2>
          <div className="card muted">
            {report.duplicates.accountGroups} account duplicate groups (
            {Math.round(report.duplicates.accountDensity * 100)}% density) · {report.duplicates.contactGroups}{' '}
            contact groups ({Math.round(report.duplicates.contactDensity * 100)}%) · {report.staleness.staleAccounts}{' '}
            accounts and {report.staleness.staleContacts} contacts untouched for {report.staleness.staleDays}+ days ·
            generated {new Date(report.generatedAt).toLocaleString()}
          </div>
        </>
      )}
    </>
  )
}
