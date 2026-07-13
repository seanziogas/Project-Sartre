'use client'

import { useActionState } from 'react'
import { askCopilotAction } from './actions'
import type { CopilotState } from './actions'

const initialState: CopilotState = {}

export function CopilotForm({ clientId }: { clientId: string }) {
  const action = askCopilotAction.bind(null, clientId)
  const [state, formAction, pending] = useActionState(action, initialState)
  return (
    <>
      <form action={formAction} className="card copilot-form">
        <label htmlFor="question">Ask about the approved client Brain</label>
        <textarea id="question" name="question" maxLength={2000} required placeholder="What positioning should we use for this segment?" />
        <button type="submit" disabled={pending}>{pending ? 'Thinking…' : 'Ask copilot'}</button>
      </form>
      {state.error && <div className="card"><span className="pill red">Unable to answer</span> {state.error}</div>}
      {state.answer && (
        <div className="card">
          <h2>Answer</h2>
          <p>{state.answer.answer}</p>
          <h2>Approved Brain evidence</h2>
          <ul>
            {state.answer.citations.map((citation, index) => (
              <li key={`${citation.source}-${index}`}><span className="mono">{citation.source}</span>: “{citation.evidence}”</li>
            ))}
          </ul>
          {state.answer.limitations.length > 0 && <p className="muted">Limitations: {state.answer.limitations.join(' ')}</p>}
        </div>
      )}
    </>
  )
}
