import { describe, expect, it } from 'vitest'
import { draftEventFollowup, planAbmAccount, prepareTakeoutPlay, scoreTamAccount } from '../src/gtm-strategist.js'

const account = { id: 'a1', name: 'Acme', fields: { industry: 'Logistics', contacts: ['Dana VP Ops'] } }
const brainContext = 'ICP: $100M+ logistics. Use case: fleet visibility. Hard disqualifier: government.'

describe('GTM Strategist known-answer evals', () => {
  it('plans a brain-grounded ABM play as a draft', async () => {
    const plan = await planAbmAccount({ account, brainContext }, {
      complete: async () => JSON.stringify({ play: 'fleet-visibility', rationale: 'Logistics matches the fleet visibility use case', contacts: ['Dana VP Ops'], skip: false, status: 'draft' }),
    })
    expect(plan).toMatchObject({ play: 'fleet-visibility', skip: false, status: 'draft' })
  })

  it('lets the model skip ICP misfits with a rationale', async () => {
    const plan = await planAbmAccount({ account, brainContext }, {
      complete: async () => JSON.stringify({ play: 'none', rationale: 'Government entity — hard disqualifier', contacts: [], skip: true, status: 'draft' }),
    })
    expect(plan.skip).toBe(true)
  })

  it('rejects an ABM plan that names contacts absent from the account record', async () => {
    await expect(planAbmAccount({ account, brainContext }, {
      complete: async () => JSON.stringify({ play: 'fleet-visibility', rationale: 'fit', contacts: ['Imaginary CFO'], skip: false, status: 'draft' }),
    })).rejects.toThrow(/contacts absent from the account record/)
  })

  it('refuses takeout candidates without evidence', async () => {
    await expect(prepareTakeoutPlay({
      candidate: { accountId: 'a1', accountName: 'Acme', competitor: 'Other', evidence: [] }, brainContext,
    }, { complete: async () => '{}' })).rejects.toThrow()
  })

  it('rejects takeout drafts whose proof does not quote the provided evidence', async () => {
    await expect(prepareTakeoutPlay({
      candidate: { accountId: 'a1', accountName: 'Acme', competitor: 'Other', evidence: ['Renewal in Q3 per CRM note'] }, brainContext,
    }, {
      complete: async () => JSON.stringify({ angle: 'renewal timing', proof: 'They are unhappy', draft: 'Hi there', status: 'draft' }),
    })).rejects.toThrow('takeout proof must quote provided evidence')
  })

  it('accepts a takeout draft grounded in the evidence verbatim', async () => {
    const draft = await prepareTakeoutPlay({
      candidate: { accountId: 'a1', accountName: 'Acme', competitor: 'Other', evidence: ['Renewal in Q3 per CRM note'] }, brainContext,
    }, {
      complete: async () => JSON.stringify({ angle: 'renewal timing', proof: 'Renewal in Q3 per CRM note', draft: 'Worth comparing before the Q3 renewal?', status: 'draft' }),
    })
    expect(draft).toMatchObject({ angle: 'renewal timing', status: 'draft' })
  })

  it('drafts event follow-ups with caller-owned play selection', async () => {
    const draft = await draftEventFollowup({
      attendee: { id: 'e1', email: 'buyer@example.com', event: 'Summit', attended: false, segment: 'enterprise' },
      play: 'no-show', brainContext,
    }, { complete: async () => JSON.stringify({ draft: 'Sorry we missed you at Summit — here is the recording.', status: 'draft' }) })
    expect(draft.draft).toContain('Summit')
  })

  it('bounds TAM scores and requires grounded reasons', async () => {
    await expect(scoreTamAccount({ account: { id: 'a1', name: 'Acme', fields: { revenue: 200 } }, brainContext }, {
      complete: async () => JSON.stringify({ score: 250, tier: 'A', reasons: ['revenue above floor'], plays: [] }),
    })).rejects.toThrow()
    const assessment = await scoreTamAccount({ account: { id: 'a1', name: 'Acme', fields: { revenue: 200 } }, brainContext }, {
      complete: async () => JSON.stringify({ score: 88, tier: 'A', reasons: ['revenue 200M clears the $100M ICP floor'], plays: ['fleet-visibility'] }),
    })
    expect(assessment).toMatchObject({ score: 88, tier: 'A' })
  })
})
