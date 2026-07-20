import { describe, expect, it } from 'vitest'
import { MemoryRunStore } from '@sartre/pipelines'
import type { RunRecord } from '@sartre/pipelines'
import { DEMO_CLIENT_ID, seedDemoRuns } from '../src/seed-demo.js'

/**
 * Proves the demo seeder produces exactly what the ops review queue reads:
 * awaiting-approval runs whose pending gates carry the brain-grounded plans.
 * The review page's listPendingGates walks run.gates for status 'pending' and
 * renders gate.payload — this test asserts that shape without a live server.
 */
function pendingGate(run: RunRecord) {
  return run.gates.find((gate) => gate.status === 'pending')
}

describe('demo seeding for the local click-through', () => {
  it('parks one awaiting-approval run per strategy module with grounded plans', async () => {
    const store = new MemoryRunStore()
    const seeded = await seedDemoRuns(store)

    expect(seeded.map((s) => s.moduleId).sort()).toEqual(['marketing.events', 'revops.tam', 'sales.abm', 'sales.takeout'])
    expect(seeded.every((s) => s.status === 'awaiting_approval')).toBe(true)

    // The Postgres round-trip (list/getScoped) is covered in packages/db; here we
    // assert the run/gate shape the review queue reads, via the awaiting-approval index.
    const runs = await store.listByStatus('awaiting_approval')
    expect(runs.map((r) => r.clientId)).toEqual([DEMO_CLIENT_ID, DEMO_CLIENT_ID, DEMO_CLIENT_ID, DEMO_CLIENT_ID])
    for (const run of runs) {
      const gate = pendingGate(run)
      expect(gate, `run ${run.runId} should have a pending gate`).toBeTruthy()
    }
  })

  it('applies the grounding guards in the seeded output', async () => {
    const store = new MemoryRunStore()
    await seedDemoRuns(store)

    const abm = pendingGate((await store.get('demo-abm'))!)!
    const abmPlan = abm.payload as { items: Array<{ accountId: string; contacts: string[] }> }
    // The government account is an ICP misfit → skipped; only Northwind survives.
    expect(abmPlan.items).toHaveLength(1)
    expect(abmPlan.items[0]).toMatchObject({ accountId: 'acc-1' })
    expect(abmPlan.items[0]!.contacts).toEqual(['Dana Reyes, VP Ops'])

    const takeout = pendingGate((await store.get('demo-takeout'))!)!
    const takeoutPlan = takeout.payload as { items: Array<{ proof: string }> }
    expect(takeoutPlan.items[0]!.proof).toContain('Renewal with Fleetio in Q3 per CRM note')

    const tam = pendingGate((await store.get('demo-tam'))!)!
    const tamPlan = tam.payload as { items: Array<{ score: number; tier: string }> }
    expect(tamPlan.items[0]).toMatchObject({ score: 84, tier: 'A' })

    const events = pendingGate((await store.get('demo-events'))!)!
    const eventsPlan = events.payload as { items: Array<{ draft: string }> }
    expect(eventsPlan.items[0]!.draft).toContain('FleetSummit')
  })
})
