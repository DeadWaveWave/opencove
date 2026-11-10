import { it, expect, vi } from 'vitest'
import { admitManagedClaudeLaunch } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionPrepareOrReviveHandler } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrReviveHandler'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import { compatibilityFixture, context, deferred } from './managedClaudeLaunchCompatibility.helpers'

it('recovery follows P2 when the owned P1 launch it joined is superseded during identity resolution', async () => {
  const f = compatibilityFixture({ enabled: false })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
  })
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo')
    return {
      sessionId: 'replacement',
      provider: 'claude-code',
      resumeSessionId: 'new',
      executionContext: { endpoint: { kind: 'local' } },
    }
  })
  const firstRead = deferred<typeof f.state>(),
    secondRead = deferred<typeof f.state>()
  const firstEntered = deferred<void>(),
    secondEntered = deferred<void>()
  f.store.readAppState.mockImplementationOnce(() => {
    firstEntered.resolve()
    return firstRead.promise
  })
  const awaitPending = vi.spyOn(f.runtime, 'awaitPending')
  registerSessionPrepareOrReviveHandler(f.surface, {
    getPersistenceStore: f.getPersistenceStore,
    ptyStreamHub: { isSessionActive: () => true } as unknown as PtyStreamHub,
    ptyRuntime: {} as never,
    terminalRecoverySpawnAdmission: f.admission.terminalRecoverySpawnAdmission,
  })
  const payload = {
    intent: {
      kind: 'launchNew',
      expected: {
        activationId: 'owned',
        tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
      },
    },
  }
  const first = f.launch(payload)
  await firstEntered.promise
  let prepared: unknown
  const preparing = f.surface
    .invoke(context, {
      kind: 'command',
      id: 'session.prepareOrRevive',
      payload: { workspaceId: 'workspace' },
    })
    .then(result => {
      prepared = result
      return result
    })
  await vi.waitFor(() => expect(awaitPending).toHaveBeenCalledWith('agent'))
  expect(prepared).toBeUndefined()
  f.store.readAppState.mockImplementationOnce(() => {
    secondEntered.resolve()
    return secondRead.promise
  })
  const second = f.launch(payload)
  await secondEntered.promise
  try {
    firstRead.resolve(f.state)
    expect(await first).toMatchObject({ ok: false, error: { details: { reason: 'superseded' } } })
    // Awaiting P1's envelope drains its released waiter; P2 must still own recovery's wait.
    expect(prepared).toBeUndefined()
    expect(f.kill).not.toHaveBeenCalled()
    secondRead.resolve(f.state)
    expect(await second).toMatchObject({ ok: true })
    expect(await preparing).toMatchObject({
      ok: true,
      value: {
        nodes: [
          {
            recoveryState: 'live',
            sessionId: 'replacement',
            managedClaudeBinding: { runtimeSessionId: 'replacement' },
          },
        ],
      },
    })
    expect(f.kill).toHaveBeenCalledExactlyOnceWith('live')
    expect(f.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(3)
  } finally {
    firstRead.resolve(f.state)
    secondRead.resolve(f.state)
    await Promise.all([first, second, preparing])
    f.runtime.dispose()
  }
})

it('uses the current owned tuple after readiness waits for reconciliation', async () => {
  const f = compatibilityFixture({ enabled: false })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
  })
  const ready = deferred<void>(),
    entered = deferred<void>()
  vi.spyOn(f.runtime.owner, 'assertReady').mockImplementationOnce(async () => {
    entered.resolve()
    await ready.promise
  })
  const observe = f.store.observeManagedClaudeNode.getMockImplementation()!
  let rebound = false
  const reboundTuple = { resumeSessionId: 'rebound', resumeSessionIdVerified: true }
  f.store.observeManagedClaudeNode.mockImplementation(id => {
    const observation = observe(id)
    return rebound && observation.binding?.activationId === 'owned'
      ? { ...observation, binding: { ...observation.binding, tuple: reboundTuple } }
      : observation
  })
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo')
    return {
      sessionId: 'replacement',
      provider: 'claude-code',
      resumeSessionId: 'rebound',
      executionContext: { endpoint: { kind: 'local' } },
    }
  })
  const launching = f.launch({ intent: { kind: 'resumeCurrent' } })
  await entered.promise
  try {
    rebound = true
    ready.resolve()
    expect(await launching).toMatchObject({ ok: true })
    expect(f.store.activateManagedClaudeRuntime).toHaveBeenLastCalledWith(
      expect.objectContaining({
        expected: {
          activationId: f.store.activateManagedClaudeRuntime.mock.calls[1][0].activationId,
          tuple: reboundTuple,
        },
        tuple: reboundTuple,
      }),
    )
  } finally {
    ready.resolve()
    await launching
    f.runtime.dispose()
  }
})

it('preserves the original context fence while refreshing the binding after readiness', async () => {
  const f = compatibilityFixture({ enabled: false })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
  })
  const ready = deferred<void>(),
    entered = deferred<void>()
  vi.spyOn(f.runtime.owner, 'assertReady').mockImplementationOnce(async () => {
    entered.resolve()
    await ready.promise
  })
  const observe = f.store.observeManagedClaudeNode.getMockImplementation()!
  let changed = false
  f.store.observeManagedClaudeNode.mockImplementation(id => {
    const observation = observe(id)
    return changed && observation.context
      ? {
          ...observation,
          context: {
            ...observation.context,
            route: JSON.stringify({ endpointId: 'local', mountId: null }),
          },
        }
      : observation
  })
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo')
    return {
      sessionId: 'replacement',
      provider: 'claude-code',
      resumeSessionId: 'cached',
      executionContext: { endpoint: { kind: 'local' } },
    }
  })
  const launching = f.launch({ intent: { kind: 'resumeCurrent' } })
  await entered.promise
  try {
    changed = true
    ready.resolve()
    expect(await launching).toMatchObject({
      ok: false,
      error: { details: { reason: 'identityConflict' } },
    })
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
  } finally {
    ready.resolve()
    await launching
    f.runtime.dispose()
  }
})

it('does not reattach a retired owned node from the workspace snapshot after waiting for launch', async () => {
  const f = compatibilityFixture({ enabled: false })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
  })
  const identityRead = deferred<typeof f.state>(),
    entered = deferred<void>()
  f.store.readAppState.mockImplementationOnce(() => {
    entered.resolve()
    return identityRead.promise
  })
  const waiting = vi.spyOn(f.runtime, 'awaitPending')
  registerSessionPrepareOrReviveHandler(f.surface, {
    getPersistenceStore: f.getPersistenceStore,
    ptyStreamHub: { isSessionActive: () => true } as unknown as PtyStreamHub,
    ptyRuntime: {} as never,
    terminalRecoverySpawnAdmission: f.admission.terminalRecoverySpawnAdmission,
  })
  const launching = f.launch({ intent: { kind: 'resumeCurrent' } })
  await entered.promise
  const preparing = f.surface.invoke(context, {
    kind: 'command',
    id: 'session.prepareOrRevive',
    payload: { workspaceId: 'workspace' },
  })
  try {
    await vi.waitFor(() => expect(waiting).toHaveBeenCalledWith('agent'))
    f.state.workspaces[0].nodes = []
    f.store.observeManagedClaudeNode.mockImplementation(nodeId => ({
      nodeId,
      binding: null,
      retired: true,
      nodeRuntimeSessionId: null,
      context: null,
    }))
    identityRead.resolve(f.state)
    expect(await launching).toMatchObject({ ok: false, error: { details: { reason: 'nodeGone' } } })
    expect(await preparing).toMatchObject({ ok: true, value: { nodes: [] } })
    expect(f.spawn).not.toHaveBeenCalled()
  } finally {
    identityRead.resolve(f.state)
    await Promise.all([launching, preparing])
    f.runtime.dispose()
  }
})

it('retains preparation context when its nested launch resolves a newer observation', async () => {
  const f = compatibilityFixture({ enabled: false })
  await f.runtime.ready()
  await f.store.activateManagedClaudeRuntime({
    nodeId: 'agent',
    activationId: 'owned',
    runtimeSessionId: 'live',
    tuple: { resumeSessionId: 'cached', resumeSessionIdVerified: true },
  })
  const ready = deferred<void>(),
    entered = deferred<void>()
  vi.spyOn(f.runtime.owner, 'assertReady').mockImplementationOnce(async () => {
    entered.resolve()
    await ready.promise
  })
  const attempt = f.runtime.owner.reserve('agent')
  f.spawn.mockImplementation(async () => {
    await admitManagedClaudeLaunch('claude-code', '/repo')
    return {
      sessionId: 'replacement',
      provider: 'claude-code',
      resumeSessionId: 'cached',
      executionContext: { endpoint: { kind: 'local' } },
    }
  })
  const preparing = f.runtime.withPreparation(attempt, () =>
    f.launch({ intent: { kind: 'resumeCurrent' } }),
  )
  await entered.promise
  const observe = f.store.observeManagedClaudeNode.getMockImplementation()!
  try {
    f.store.observeManagedClaudeNode.mockImplementation(id => {
      const observation = observe(id)
      return {
        ...observation,
        context: {
          ...observation.context!,
          route: JSON.stringify({ endpointId: 'local', mountId: null }),
        },
      }
    })
    ready.resolve()
    expect(await preparing).toMatchObject({
      ok: false,
      error: { details: { reason: 'identityConflict' } },
    })
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.store.activateManagedClaudeRuntime).toHaveBeenCalledTimes(1)
  } finally {
    ready.resolve()
    await preparing
    f.runtime.dispose()
  }
})
