import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '../../support/convergence/client'
import { fixture, snapshot } from '../../support/convergence/fixture'
import {
  getPendingPublication,
  canAcceptCanonicalState,
  getSyncedPersistedState,
} from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { markPersistedStateAsSynced } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import { drainPersistedStateAtQuit } from '@contexts/workspace/presentation/renderer/utils/persistence/drain'
import {
  projectManagedClaudeRuntimeData,
  confirmManagedClaudeRuntime,
} from '@contexts/workspace/presentation/renderer/utils/managedClaudeProjection'
import { toRuntimeNodes } from '@contexts/workspace/presentation/renderer/utils/nodeTransform'
import { projectOwnedManagedClaudeNode } from '@shared/sync/managedClaudeResumeProjection'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { mergeRuntimeSessionBinding } from '@app/renderer/shell/hooks/workerSync/runtimeSessionBinding'
let client: Client | undefined
function setup(
  response: ConstructorParameters<typeof Client>[2] = 'committed',
  adapter: ConstructorParameters<typeof Client>[1] = 'local',
  owned = false,
) {
  client = new Client(owned, adapter, response)
  client.check = () => {} // Each minimized trace asserts its own specific counterexample.
  return client
}
afterEach(async () => {
  await client?.close()
  client = undefined
})
it('retains a queued rename during observation refresh without a pending write', async () => {
  const c = setup()
  await c.step('rename')
  await c.step('schedule')
  c.server.model.value.title = 'Remote'
  c.server.model.history.set(++c.server.model.revision, { ...c.server.model.value })
  await c.step('observe')
  await c.step('refresh')
  expect(c.state().workspaces[0].name).toBe('user-0')
})
it('records the subsequently submitted draft when its response is lost', async () => {
  const c = setup('corrected')
  await c.step('rename')
  await c.step('flush')
  await c.step('rename')
  c.server.response = 'lost-committed'
  await c.step('flush')
  expect(getPendingPublication()).toMatchObject({ unknownOutcome: true })
  expect(JSON.parse(getPendingPublication()!.candidateRaw).workspaces[0].name).toBe('user-1')
  c.server.model.thirdParty()
  await c.step('observe')
  await c.step('refresh')
  expect(c.server.writes).toBe(2)
})
it.each(['web', 'raw'] as const)('retains unknown %s submissions without replay', async adapter => {
  const c = setup('lost-committed', adapter)
  await c.step('rename')
  await c.step('flush')
  expect(getPendingPublication()).toMatchObject({ unknownOutcome: true })
  await c.step('flush')
  expect(c.server.writes).toBe(1)
})
it('rejects a stale quit repair read before publishing captured edits', async () => {
  const c = setup('identity')
  await c.step('rename')
  await c.step('flush')
  const captured = c.state(),
    old = snapshot(c.server.template, c.server.model.value)
  c.server.model.thirdParty()
  markPersistedStateAsSynced(
    snapshot(c.server.template, c.server.model.value),
    c.server.model.revision,
  )
  c.server.stale = { state: old, revision: 1 }
  expect(await drainPersistedStateAtQuit(captured, 30)).toBe(false)
  expect(c.server.writes).toBe(1)
})
it('supersedes a delayed fallback using canonical node association with a null ledger runtime', () => {
  setup('committed', 'local', true)
  const state = fixture(true),
    node = state.workspaces[0].nodes[0]
  node.managedClaudeResumeBindingOwnership = {
    ...node.managedClaudeResumeBindingOwnership!,
    runtimeSessionId: null,
  }
  node.sessionId = 'shell-T'
  markPersistedStateAsSynced(state, 3)
  const data = toRuntimeNodes(state.workspaces[0])[0].data
  const delayed = {
    ...data,
    sessionId: 'shell-S',
    runtimeSessionBinding: { phase: 'publishing' as const, sessionId: 'shell-S' },
    managedClaudeBindingObservation: {
      nodeId: 'agent',
      activationId: 'activation',
      runtimeSessionId: null,
      tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
      nodeSeen: true,
      bindingRevision: 1,
      observedRevision: 1,
    },
  }
  expect(projectManagedClaudeRuntimeData('agent', delayed)).toBeNull()
  expect(mergeRuntimeSessionBinding(data, delayed)).toMatchObject({
    sessionId: 'shell-T',
    runtimeSessionBinding: undefined,
  })
})
it.each([null, {}, { provider: 'pi', executionDirectory: null }])(
  'restores complete canonical agent from invalid proposal %j',
  agent => {
    const workspace = fixture(true).workspaces[0],
      node = workspace.nodes[0]
    const repaired = projectOwnedManagedClaudeNode(node, { ...node, agent })
    expect(
      ensurePersistedWorkspace({ ...workspace, nodes: [repaired] })!.nodes[0].agent,
    ).toMatchObject({
      executionDirectory: '/tmp/convergence',
      prompt: 'Review',
      provider: 'claude-code',
    })
  },
)
it('does not compare local viewport preferences as canonical shared content', () => {
  setup()
  const state = structuredClone(getSyncedPersistedState()!)
  state.workspaces[0].viewport = { x: 55, y: 99, zoom: 2 }
  expect(canAcceptCanonicalState(state, 1)).toBe(true)
})
it('applies post-submit collapse intent while acknowledging original canonical content', async () => {
  const c = setup('corrected')
  await c.step('rename')
  await c.step('flush')
  await c.step('collapse')
  await c.step('refresh')
  expect(c.state().workspaces[0].collapsedNodeIds).toContain('agent')
})
it.each(['corrected', 'merged'] as const)(
  'migrates surviving terminal history after a %s migration',
  async response => {
    const c = setup(response)
    await expect(c.step('migration')).resolves.toBeUndefined()
    expect(c.server.scrollbacks.get('terminal')).toBe('legacy history')
  },
)
it('accepts a row-only settled fallback after definitive lookup', async () => {
  const c = setup('committed', 'local', true),
    data = toRuntimeNodes(c.state().workspaces[0])[0].data
  const binding = {
    nodeId: 'fresh',
    activationId: 'settled',
    runtimeSessionId: null,
    tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    nodeSeen: false,
    bindingRevision: 1,
    observedRevision: 1,
  }
  window.opencoveApi.controlSurface = {
    invoke: vi.fn(async () => ({
      retired: false,
      managedClaudeBinding: binding,
      nodeRuntimeSessionId: null,
    })),
  } as never
  expect(
    await confirmManagedClaudeRuntime('fresh', {
      ...data,
      sessionId: 'shell-S',
      managedClaudeBindingObservation: binding,
    }),
  ).toMatchObject({ sessionId: 'shell-S' })
})
it('retains an unknown raw replacement even when its submitted text cannot be parsed', async () => {
  const c = setup(),
    write = vi.fn(async () => {
      throw new Error('Response lost')
    })
  window.opencoveApi.persistence.writeWorkspaceStateRaw = write
  const { writeRawPersistedState } =
    await import('@contexts/workspace/presentation/renderer/utils/persistence/write')
  expect(await writeRawPersistedState('unconfirmed import')).toMatchObject({
    ok: false,
    outcome: 'unknown',
  })
  expect(getPendingPublication()).toMatchObject({
    unknownOutcome: true,
    submittedRaw: 'unconfirmed import',
  })
  await writeRawPersistedState('unconfirmed import')
  expect(write).toHaveBeenCalledOnce()
  expect(c.server.writes).toBe(0)
})
