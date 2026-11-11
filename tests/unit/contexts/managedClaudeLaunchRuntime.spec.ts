import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { describe, it, expect, vi } from 'vitest'
import {
  createManagedClaudeLaunchRuntime,
  admitManagedClaudeLaunch,
} from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { sessionLaunchAgentOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/session'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type {
  ManagedClaudeBindingObservation,
  ManagedClaudeNodeObservation,
} from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
const absent = {
  activationId: null,
  tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => {
    resolve = done
  })
  return { promise, resolve }
}
const context = {
  clientFeatures: { managedClaudeResumeBindingV1: true },
  now: () => new Date(),
  capabilities: {},
} as ControlSurfaceContext
function fixture() {
  let pauseSpawn = async () => {}
  let runtimeActive = true
  let binding: ManagedClaudeBindingObservation | null = null
  let nodeContext: ManagedClaudeNodeObservation['context'] = {
    kind: 'agent',
    provider: 'claude-code',
    directory: '/repo',
    route: 'null',
  }
  const store = {
    readAppState: vi.fn(async () => null),
    observeManagedClaudeNode: () => ({
      nodeId: 'agent',
      binding,
      retired: false,
      context: nodeContext,
    }),
    isManagedClaudeRuntimeReferenced: () => false,
    activateManagedClaudeRuntime: vi.fn(async input => {
      binding = {
        nodeId: input.nodeId,
        activationId: input.activationId,
        runtimeSessionId: input.runtimeSessionId,
        tuple: input.tuple,
        nodeSeen: true,
        bindingRevision: 2,
        observedRevision: 2,
      }
      return { status: 'committed', revision: 2 }
    }),
  } satisfies Partial<PersistenceStore>
  const kill = vi.fn(async () => {})
  const runtime = createManagedClaudeLaunchRuntime({
    getPersistenceStore: async () => store as PersistenceStore,
    killExactRuntime: kill,
    hasRuntime: () => runtimeActive,
    adoptionEnabled: () => true,
  })
  const firstIdentity = deferred<{ projectId: string; spaceId: string; nodeId: string }>()
  let reads = 0
  const surface = createControlSurface({
    run: createCanvasSpawnRunner({
      managedClaude: runtime,
      terminalRuntimeAvailability: { assertSpawnAllowed: () => {} },
      getPersistenceStore: async () => store as PersistenceStore,
      resolveIdentity: async () =>
        ++reads === 1
          ? firstIdentity.promise
          : { projectId: 'project', spaceId: 'space', nodeId: 'agent' },
    }),
  })
  let spawns = 0
  registerOperation(surface, sessionLaunchAgentOperation, {
    defaultErrorCode: 'agent.launch_failed',
    handle: async () => {
      await admitManagedClaudeLaunch('claude-code', '/repo')
      await pauseSpawn()
      return {
        sessionId: `runtime-${++spawns}`,
        provider: 'claude-code',
        resumeSessionId: 'B',
        executionContext: { endpoint: { kind: 'local' } },
      }
    },
  })
  const launch = () =>
    surface.invoke(context, {
      kind: 'command',
      id: 'session.launchAgent',
      payload: {
        canvasNodeId: 'agent',
        cwd: '/repo',
        prompt: '',
        provider: 'claude-code',
        intent: { kind: 'launchNew', expected: absent },
      },
    })
  return {
    launch,
    runtime,
    firstIdentity,
    store,
    kill,
    pauseSpawn: (pause: () => Promise<void>) => {
      pauseSpawn = pause
    },
    setRuntimeActive: (active: boolean) => {
      runtimeActive = active
    },
    changeContext: () => {
      nodeContext = { ...nodeContext!, directory: '/other' }
    },
  }
}
describe('managed Claude launch composition', () => {
  it('reserves before asynchronous identity resolution through the real wrapper', async () => {
    const { launch, firstIdentity, store } = fixture()
    const first = launch()
    const second = await launch()
    expect(second.ok).toBe(true)
    firstIdentity.resolve({ projectId: 'project', spaceId: 'space', nodeId: 'agent' })
    expect(await first).toMatchObject({ ok: false, error: { details: { reason: 'superseded' } } })
    expect(store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
  })
})

it('live preparation waits for the current launch without reserving a replacement', async () => {
  const fixtureState = fixture()
  const started = deferred<void>(),
    release = deferred<void>()
  fixtureState.pauseSpawn(async () => {
    started.resolve()
    await release.promise
  })
  const first = fixtureState.launch()
  fixtureState.firstIdentity.resolve({ projectId: 'project', spaceId: 'space', nodeId: 'agent' })
  await started.promise
  let settled = false
  const observation = fixtureState.runtime.awaitPending('agent').then(() => {
    settled = true
  })
  await Promise.resolve()
  expect(settled).toBe(false)
  release.resolve()
  expect((await first).ok).toBe(true)
  await observation
  expect(settled).toBe(true)
  expect(fixtureState.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
})

it('fences a first-adoption directory change while spawn is pending', async () => {
  const fixtureState = fixture()
  const started = deferred<void>(),
    release = deferred<void>()
  fixtureState.pauseSpawn(async () => {
    started.resolve()
    await release.promise
  })
  const first = fixtureState.launch()
  fixtureState.firstIdentity.resolve({ projectId: 'project', spaceId: 'space', nodeId: 'agent' })
  await started.promise
  fixtureState.changeContext()
  release.resolve()
  expect(await first).toMatchObject({
    ok: false,
    error: { details: { reason: 'identityConflict' } },
  })
  expect(fixtureState.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
  expect(fixtureState.kill).toHaveBeenCalledWith('runtime-1')
})

it('does not activate a runtime that exited after registration', async () => {
  const fixtureState = fixture()
  fixtureState.setRuntimeActive(false)
  const pending = fixtureState.launch()
  fixtureState.firstIdentity.resolve({ projectId: 'project', spaceId: 'space', nodeId: 'agent' })
  expect(await pending).toMatchObject({
    ok: false,
    error: { details: { reason: 'resumeUnavailable' } },
  })
  expect(fixtureState.store.activateManagedClaudeRuntime).not.toHaveBeenCalled()
})
