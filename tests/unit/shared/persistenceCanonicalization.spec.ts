import { expect, it } from 'vitest'
import { canonicalizePersistedAppState } from '@shared/sync/canonicalizePersistedAppState'
import { normalizeAgentSettings } from '@contexts/settings/domain/agentSettings'
import { canonicalContent } from '@shared/sync/mergeValue'
import { fixture } from '../../support/convergence/fixture'
import { sqliteWireState } from '../../support/convergence/sqliteWire'
import { canonicalCases } from '../../support/convergence/canonicalCases'
const normalize = (state: unknown) => canonicalizePersistedAppState(state, normalizeAgentSettings)
it.each(canonicalCases)(
  'shares a pure, idempotent SQLite representation for $field',
  ({ change }) => {
    const input = fixture(false)
    change(input)
    const before = structuredClone(input)
    const canonical = normalize(input)
    expect(canonical).not.toBeNull()
    expect(canonical).toEqual(normalize(sqliteWireState(input)))
    expect(normalize(canonical)).toEqual(canonical)
    expect(input).toEqual(before)
  },
)
it('ignores unordered node rows and view preferences while preserving semantic array order', () => {
  const input = fixture(false)
  const reordered = structuredClone(input)
  reordered.workspaces[0].nodes.reverse()
  reordered.workspaces[0].viewport = { x: 23, y: 45, zoom: 2 }
  reordered.workspaces[0].activeSpaceId = 'second'
  reordered.workspaces[0].isMinimapVisible = false
  expect(normalize(input)).toEqual(normalize(reordered))
  const links = structuredClone(input)
  links.workspaces[0].spaces[0].nodeIds = ['agent', 'terminal']
  const reversedLinks = structuredClone(links)
  reversedLinks.workspaces[0].spaces[0].nodeIds.reverse()
  expect(normalize(links)).not.toEqual(normalize(reversedLinks))
  const two = structuredClone(input)
  two.workspaces.push({
    ...structuredClone(input.workspaces[0]),
    id: 'other',
    nodes: [],
    spaces: [],
  })
  const reversedWorkspaces = structuredClone(two)
  reversedWorkspaces.workspaces.reverse()
  expect(normalize(two)).not.toEqual(normalize(reversedWorkspaces))
  reordered.settings.agentProviderOrder.reverse()
  expect(normalize(input)).not.toEqual(normalize(reordered))
})
it('does not erase actual shared changes or confuse null defaults with rejection', () => {
  const input = fixture(false)
  const changed = structuredClone(input)
  changed.workspaces[0].name = 'Renamed'
  expect(canonicalContent(normalize(input))).not.toBe(canonicalContent(normalize(changed)))
  expect(normalize({ malformed: true })).toBeNull()
})
it('compares hydrated terminal bindings with their serialized durable payload', () => {
  const durable = fixture(false)
  durable.workspaces[0].nodes[1].agent = {
    provider: 'codex',
    resumeSessionId: 'A',
    resumeSessionIdVerified: true,
  }
  const hydrated = structuredClone(durable)
  hydrated.workspaces[0].nodes[1].terminalAgentBinding = hydrated.workspaces[0].nodes[1].agent
  hydrated.workspaces[0].nodes[1].agent = null
  expect(normalize(hydrated)).toEqual(normalize(durable))
})
