import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerNodeControlHandlers } from '../../../src/app/main/controlSurface/handlers/nodeControlHandlers'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
// @vitest-environment node
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describeWithElectronNativeModules } from '../electronNativeSuite'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { stateWithAgent, tupleA, tupleB } from './managedClaudeResumeBindingFixtures'

describeWithElectronNativeModules('managed Claude fallback runtime replacement', () => {
  let root: string
  let store: Awaited<ReturnType<typeof createPersistenceStore>>
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'opencove-fallback-replacement-'))
    store = await createPersistenceStore({ dbPath: join(root, 'state.db'), strictRecovery: true })
  })
  afterEach(async () => {
    store?.dispose()
    await rm(root, { recursive: true, force: true })
  })
  it.each([
    { mode: 'resume', tuple: tupleA },
    { mode: 'relaunch', tuple: tupleB },
  ])('cleans the exact persisted fallback shell after confirmed $mode', async ({ tuple }) => {
    await store.writeAppState(stateWithAgent())
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'fallback-settlement',
      runtimeSessionId: null,
      tuple: tupleA,
    })
    const state = stateWithAgent()
    state.workspaces[0].nodes[0].sessionId = 'fallback-shell'
    await store.writeAppState(state)
    const before = store.observeManagedClaudeNode('agent')
    expect(before).toMatchObject({
      nodeRuntimeSessionId: 'fallback-shell',
      binding: { runtimeSessionId: null },
    })
    const kill = vi.fn(async id => {
      expect(store.isManagedClaudeRuntimeReferenced(id)).toBe(false)
    })
    const activate = vi.fn(input => {
      expect(kill).not.toHaveBeenCalled()
      return store.activateManagedClaudeRuntime(input)
    })
    const owner = new ManagedClaudeLaunchOwner({
      observeNode: store.observeManagedClaudeNode,
      activateManagedClaudeRuntime: activate,
      isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
      killExactRuntime: kill,
      createId: () => 'replacement',
      publishCommittedActivation: () => {},
    })
    try {
      const attempt = owner.reserve('agent')
      attempt.context = before.context
      attempt.expected = {
        activationId: before.binding!.activationId,
        tuple: before.binding!.tuple,
      }
      await owner.admit(attempt, { provider: 'claude-code', cwd: '/repo', mountId: null })
      expect(kill).not.toHaveBeenCalled()
      await owner.complete(attempt, { runtimeSessionId: 'new-runtime', tuple })
      expect(store.observeManagedClaudeNode('agent')).toMatchObject({
        nodeRuntimeSessionId: 'new-runtime',
        binding: { runtimeSessionId: 'new-runtime', tuple },
      })
      expect(kill).toHaveBeenCalledExactlyOnceWith('fallback-shell')
    } finally {
      owner.dispose()
    }
  })
  it('queries definitive absence and row-only ownership without a persisted node', async () => {
    const surface = createControlSurface()
    registerNodeControlHandlers(surface, {
      getPersistenceStore: async () => store,
      topology: {} as never,
    })
    const read = () =>
      surface.invoke({ now: () => new Date() } as ControlSurfaceContext, {
        kind: 'query',
        id: 'node.managedClaudeBinding',
        payload: { nodeId: 'agent' },
      })
    expect(await read()).toMatchObject({
      ok: true,
      value: { managedClaudeBinding: null, retired: false, executionDirectory: null },
    })
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'unseen',
      runtimeSessionId: 'unseen-runtime',
      tuple: tupleA,
    })
    expect(await read()).toMatchObject({
      ok: true,
      value: {
        managedClaudeBinding: { nodeSeen: false, runtimeSessionId: 'unseen-runtime' },
        retired: false,
        executionDirectory: null,
      },
    })
  })
})
