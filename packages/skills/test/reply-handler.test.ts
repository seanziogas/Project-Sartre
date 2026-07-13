import { describe, expect, it } from 'vitest'
import { draftReply } from '../src/reply-handler.js'

describe('Reply Handler known-answer eval', () => {
  it('returns a draft and never claims an external send', async () => {
    const result = await draftReply({ message: 'Can you send pricing?', sender: 'buyer@example.com', brainContext: 'Offer a discovery call.' }, {
      complete: async () => JSON.stringify({ classification: 'question', reasoning: 'Pricing question', draft: 'Happy to discuss pricing on a short call.', sendRecommended: true, status: 'draft' }),
    })
    expect(result).toMatchObject({ classification: 'question', status: 'draft' })
  })

  it('structurally prevents an unsubscribe response draft', async () => {
    await expect(draftReply({ message: 'Unsubscribe', sender: 'buyer@example.com', brainContext: 'Respect opt-outs.' }, {
      complete: async () => JSON.stringify({ classification: 'unsubscribe', reasoning: 'Explicit opt-out', draft: 'Okay', sendRecommended: true, status: 'draft' }),
    })).rejects.toThrow('unsubscribe replies')
  })
})
