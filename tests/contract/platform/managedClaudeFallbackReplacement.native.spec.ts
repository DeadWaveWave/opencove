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
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from '../../unit/contexts/controlSurfaceTestTerminalAvailability'

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
  it('preserves the healthy owned runtime when actual path approval rejects before admission', async () => {
    await store.writeAppState(stateWithAgent())
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'initial',
      runtimeSessionId: 'original',
      tuple: tupleA,
    })
    const before = store.observeManagedClaudeNode('agent')
    const kill = vi.fn(async () => {})
    const runtime = createManagedClaudeLaunchRuntime({
      getPersistenceStore: async () => store,
      adoptionEnabled: () => false,
      hasRuntime: () => true,
      killExactRuntime: kill,
    })
    await runtime.ready()
    const admission = createReadyTerminalAdmissionDeps()
    const surface = createControlSurface({
      run: createCanvasSpawnRunner({
        managedClaude: runtime,
        terminalRuntimeAvailability: admission.terminalSpawnAdmission,
        getPersistenceStore: async () => store,
      }),
    })
    const spawn = vi.fn()
    registerSessionHandlers(surface, {
      ...admission,
      userDataPath: root,
      getPersistenceStore: async () => store,
      approvedWorkspaces: { isPathApproved: async () => false } as never,
      agentProviderRegistry: createTestAgentProviderRegistry(),
      topology: {} as never,
      ptyRuntime: { spawnSession: spawn } as never,
      ptyStreamHub: {} as never,
    })
    try {
      expect(
        await surface.invoke({ now: () => new Date(), capabilities: {} } as ControlSurfaceContext, {
          kind: 'command',
          id: 'session.launchAgent',
          payload: {
            canvasNodeId: 'agent',
            cwd: '/repo',
            provider: 'claude-code',
            prompt: 'fixture',
            intent: { kind: 'resumeCurrent' },
          },
        }),
      ).toMatchObject({ ok: false, error: { code: 'common.approved_path_required' } })
      expect(store.observeManagedClaudeNode('agent')).toEqual(before)
      expect(kill).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
      expect(runtime.owner.pendingCleanupRuntimeIds()).toEqual([])
    } finally {
      runtime.dispose()
    }
  })

  it('retains a failed admission kill through null settlement and a later reference-checked retry', async () => {
    await store.writeAppState(stateWithAgent())
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'initial',
      runtimeSessionId: 'original',
      tuple: tupleA,
    })
    const alive = new Set(['original'])
    const kill = vi.fn(async (id: string) => {
      expect(store.isManagedClaudeRuntimeReferenced(id)).toBe(false)
      if (kill.mock.calls.length === 1) {
        throw new Error('kill unavailable')
      }
      alive.delete(id)
    })
    const owner = new ManagedClaudeLaunchOwner({
      observeNode: store.observeManagedClaudeNode,
      activateManagedClaudeRuntime: store.activateManagedClaudeRuntime,
      isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
      killExactRuntime: kill,
      createId: () => 'settled',
      publishCommittedActivation: () => {},
    })
    try {
      const before = store.observeManagedClaudeNode('agent')
      const attempt = owner.reserve('agent')
      attempt.context = before.context
      attempt.expected = { activationId: before.binding!.activationId, tuple: tupleA }
      await expect(
        owner.admit(attempt, { provider: 'claude-code', cwd: '/repo', mountId: null }),
      ).rejects.toMatchObject({ code: 'agent.launch_failed' })
      expect(store.observeManagedClaudeNode('agent')).toMatchObject({
        nodeRuntimeSessionId: null,
        binding: { runtimeSessionId: null, tuple: tupleA },
      })
      expect(alive.has('original')).toBe(true)
      expect(owner.pendingCleanupRuntimeIds()).toEqual(['original'])
      expect(await owner.fail(attempt)).toMatchObject({
        binding: { runtimeSessionId: null, tuple: tupleA },
      })
      expect(kill).toHaveBeenCalledTimes(1)
      await owner.assertReady(owner.reserve('agent'))
      expect(kill).toHaveBeenCalledTimes(2)
      expect(alive.size).toBe(0)
      expect(owner.pendingCleanupRuntimeIds()).toEqual([])
    } finally {
      owner.dispose()
    }
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
  it('cleans both runtimes after deletion between a committed replacement and deferred reconciliation', async () => {
    await store.writeAppState(stateWithAgent())
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'settled',
      runtimeSessionId: null,
      tuple: tupleA,
    })
    const state = stateWithAgent()
    state.workspaces[0].nodes[0].sessionId = 'fallback-shell'
    await store.writeAppState(state)
    let unavailable = false
    let reconcile!: () => void
    const kill = vi.fn(async (id: string) => {
      expect(store.isManagedClaudeRuntimeReferenced(id)).toBe(false)
    })
    const owner = new ManagedClaudeLaunchOwner({
      observeNode: id => {
        if (unavailable) {
          throw new Error('confirmation unavailable')
        }
        return store.observeManagedClaudeNode(id)
      },
      activateManagedClaudeRuntime: async input => {
        const result = await store.activateManagedClaudeRuntime(input)
        unavailable = true
        return result
      },
      isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
      killExactRuntime: kill,
      createId: () => 'replacement',
      publishCommittedActivation: () => {},
      scheduleReconciliation: callback => {
        reconcile = callback
        return () => {}
      },
    })
    const unsubscribe = store.onAppStateCommitted(event =>
      owner.noteNodesDeleted(event.removedNodeIds),
    )
    try {
      const before = store.observeManagedClaudeNode('agent')
      const attempt = owner.reserve('agent')
      attempt.context = before.context
      attempt.expected = {
        activationId: before.binding!.activationId,
        tuple: before.binding!.tuple,
      }
      await owner.admit(attempt, { provider: 'claude-code', cwd: '/repo', mountId: null })
      await expect(
        owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: tupleB }),
      ).rejects.toMatchObject({ details: { outcome: 'unknown' } })
      expect(store.observeManagedClaudeNode('agent').binding?.runtimeSessionId).toBe('candidate')
      expect(kill).not.toHaveBeenCalled()
      state.workspaces[0].nodes = []
      await store.writeAppState(state)
      expect(store.observeManagedClaudeNode('agent')).toMatchObject({
        retired: true,
        binding: null,
      })
      expect(kill).not.toHaveBeenCalled()
      unavailable = false
      reconcile()
      await vi.waitFor(() =>
        expect(kill.mock.calls.map(([id]) => id).sort()).toEqual(['candidate', 'fallback-shell']),
      )
    } finally {
      unsubscribe()
      owner.dispose()
    }
  })

  it('retries a failed deletion kill after confirmation has queued deferred finalization', async () => {
    await store.writeAppState(stateWithAgent())
    await store.activateManagedClaudeRuntime({
      nodeId: 'agent',
      activationId: 'settled',
      runtimeSessionId: null,
      tuple: tupleA,
    })
    const state = stateWithAgent()
    state.workspaces[0].nodes[0].sessionId = 'fallback-shell'
    await store.writeAppState(state)
    const deleted = stateWithAgent()
    deleted.workspaces[0].nodes = []
    const steps: string[] = []
    let queued = false,
      candidateKills = 0
    let deletion: ReturnType<typeof store.writeAppState> | undefined
    let deletionCleanup: Promise<boolean> | undefined
    const owner = new ManagedClaudeLaunchOwner({
      observeNode: id => {
        const observation = store.observeManagedClaudeNode(id)
        if (observation.binding?.activationId === 'replacement' && !queued) {
          queued = true
          queueMicrotask(() => {
            deletion = store.writeAppState(deleted)
          })
        }
        return observation
      },
      activateManagedClaudeRuntime: store.activateManagedClaudeRuntime,
      isRuntimeReferenced: store.isManagedClaudeRuntimeReferenced,
      killExactRuntime: async id => {
        expect(store.isManagedClaudeRuntimeReferenced(id)).toBe(false)
        if (id === 'candidate' && ++candidateKills === 1) {
          throw new Error('kill unavailable')
        }
      },
      createId: () => 'replacement',
      publishCommittedActivation: () => {
        steps.push('finalization')
      },
    })
    const unsubscribe = store.onAppStateCommitted(event => {
      if (event.removedNodeIds.includes('agent')) {
        steps.push('deletion')
      }
      owner.noteNodesDeleted(event.removedNodeIds)
      for (const id of event.removedManagedRuntimeSessionIds) {
        deletionCleanup = owner.cleanup(id)
      }
    })
    try {
      const before = store.observeManagedClaudeNode('agent')
      const attempt = owner.reserve('agent')
      attempt.context = before.context
      attempt.expected = {
        activationId: before.binding!.activationId,
        tuple: before.binding!.tuple,
      }
      await owner.admit(attempt, { provider: 'claude-code', cwd: '/repo', mountId: null })
      await owner.complete(attempt, { runtimeSessionId: 'candidate', tuple: tupleB })
      await deletion
      await deletionCleanup
      expect(steps).toEqual(['deletion', 'finalization'])
      expect(candidateKills).toBe(1)
      await owner.assertReady(owner.reserve('agent'))
      expect(candidateKills).toBe(2)
      await owner.assertReady(owner.reserve('agent'))
      expect(candidateKills).toBe(2)
    } finally {
      unsubscribe()
      owner.dispose()
    }
  })
})
