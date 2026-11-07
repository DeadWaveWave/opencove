import { expect, it } from 'vitest'
import { normalizeNodeForMerge } from '@shared/sync/normalizePersistedAppStateForMerge'
import { canonicalContent } from '@shared/sync/mergeValue'
import type { PersistedNodeContract } from '@shared/contracts/persistedAppState'

const binding = {
  provider: 'codex' as const,
  resumeSessionId: 'verified-session',
  resumeSessionIdVerified: true,
}
const terminal: PersistedNodeContract = {
  id: 'terminal',
  kind: 'terminal',
  title: 'Terminal',
  position: { x: 0, y: 0 },
  width: 500,
  height: 300,
  agent: binding,
}

it.each([binding, null])(
  'canonicalizes durable and hydrated terminal binding %j equally',
  agent => {
    const durable = normalizeNodeForMerge({ ...terminal, agent })
    const hydrated = normalizeNodeForMerge({
      ...terminal,
      agent: null,
      terminalAgentBinding: agent,
    })
    expect(hydrated.agent).toEqual(agent)
    expect(canonicalContent(hydrated)).toBe(canonicalContent(durable))
    expect(canonicalContent(normalizeNodeForMerge(hydrated))).toBe(canonicalContent(durable))
    expect(JSON.parse(canonicalContent(hydrated)!)).not.toHaveProperty('terminalAgentBinding')
  },
)

it('does not promote a terminal projection on other node kinds', () => {
  const normalized = normalizeNodeForMerge({
    ...terminal,
    kind: 'note',
    agent: null,
    terminalAgentBinding: binding,
    task: { text: 'note' },
  })
  expect(normalized.agent).toBeNull()
  expect(normalized.task).toEqual({ text: 'note' })
})
