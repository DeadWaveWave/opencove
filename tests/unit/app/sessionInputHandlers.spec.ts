import { describe, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

it('refuses input to a replacement session when the host captured an older binding', async () => {
  const store = createInMemoryPersistenceStore()
  const state = createMinimalState('/repo', 'project', 'space')
  state.workspaces[0].nodes = [
    {
      id: 'node',
      sessionId: 'new',
      title: 'Terminal',
      kind: 'terminal',
      position: { x: 0, y: 0 },
      width: 300,
      height: 200,
      labelColorOverride: null,
      status: 'running',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      agent: null,
      task: null,
      scrollback: null,
    },
  ]
  await store.writeAppState(state)
  const writeAutomation = vi.fn()
  const control = createControlSurface()
  registerSessionInputHandlers(control, {
    getPersistenceStore: async () => store,
    ptyRuntime: { kill: vi.fn() },
    ptyStreamHub: { writeAutomation } as unknown as PtyStreamHub,
  })
  const result = await control.invoke(
    { now: () => new Date() },
    {
      id: 'session.writeNode',
      kind: 'command',
      payload: { nodeId: 'node', sessionId: 'old', data: 'unexpected' },
    },
  )
  expect(result.ok).toBe(false)
  expect(writeAutomation).not.toHaveBeenCalled()
})

describe('queued node binding validation', () => {
  it('rechecks after queue readiness and retains the original identity', async () => {
    const store = createInMemoryPersistenceStore()
    const state = createMinimalState('/repo', 'project', 'space')
    state.workspaces[0].nodes = [
      {
        id: 'node',
        sessionId: 'old',
        title: 'Terminal',
        kind: 'terminal',
        position: { x: 0, y: 0 },
        width: 300,
        height: 200,
        labelColorOverride: null,
        status: 'running',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        agent: null,
        task: null,
        scrollback: null,
      },
    ]
    await store.writeAppState(state)
    const writeAutomation = vi.fn(async (input: Parameters<PtyStreamHub['writeAutomation']>[0]) => {
      expect(input.sessionId).toBe('old')
      state.workspaces[0].nodes[0].sessionId = 'new'
      await store.writeAppState(state)
      await input.validateBinding()
    })
    const control = createControlSurface()
    registerSessionInputHandlers(control, {
      getPersistenceStore: async () => store,
      ptyRuntime: { kill: vi.fn() },
      ptyStreamHub: { writeAutomation } as unknown as PtyStreamHub,
    })
    const result = await control.invoke(
      { now: () => new Date() },
      {
        id: 'session.writeNode',
        kind: 'command',
        payload: { nodeId: 'node', sessionId: 'old', data: 'unexpected' },
      },
    )
    expect(result.ok).toBe(false)
    expect(writeAutomation).toHaveBeenCalledTimes(1)
  })
})

it.each([true, false])(
  'stops only a live bound PTY (live=%s) without deleting or writing input',
  async live => {
    const store = createInMemoryPersistenceStore()
    const state = createMinimalState('/repo', 'project', 'space')
    state.workspaces[0].nodes = [
      {
        id: 'node',
        kind: 'agent',
        sessionId: 'session',
        title: 'Lead',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        status: 'running',
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        agent: null,
        task: null,
        scrollback: null,
        labelColorOverride: null,
      },
    ]
    await store.writeAppState(state)
    const kill = vi.fn(),
      writeAutomation = vi.fn()
    const control = createControlSurface()
    registerSessionInputHandlers(control, {
      getPersistenceStore: async () => store,
      ptyRuntime: { kill },
      ptyStreamHub: { isSessionActive: () => live, writeAutomation } as unknown as PtyStreamHub,
    })
    const stop = (sessionId = 'session') =>
      control.invoke(
        { now: () => new Date() },
        { id: 'session.stopNode', kind: 'command', payload: { nodeId: 'node', sessionId } },
      )
    expect(await stop('old')).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
    expect(kill).not.toHaveBeenCalled()
    expect(await stop()).toMatchObject({
      ok: true,
      value: {
        nodeId: 'node',
        sessionId: 'session',
        stopped: live,
        ...(live ? {} : { reason: 'not_running' }),
      },
    })
    expect(kill).toHaveBeenCalledTimes(live ? 1 : 0)
    if (live) {
      expect(kill).toHaveBeenCalledWith('session')
    }
    expect(writeAutomation).not.toHaveBeenCalled()
    expect(await store.readAppState()).toEqual(state)
  },
)

it('does not kill after the request generation retires during binding lookup', async () => {
  const kill = vi.fn()
  const control = createControlSurface()
  const store = createInMemoryPersistenceStore()
  const state = createMinimalState('/repo', 'project', 'space')
  state.workspaces[0].nodes = [
    {
      id: 'node',
      kind: 'terminal',
      sessionId: 'session',
      title: 'Shell',
      position: { x: 0, y: 0 },
      width: 400,
      height: 300,
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      agent: null,
      task: null,
      scrollback: null,
      labelColorOverride: null,
    },
  ]
  await store.writeAppState(state)
  let active = true
  registerSessionInputHandlers(control, {
    getPersistenceStore: async () => {
      active = false
      return store
    },
    ptyRuntime: { kill },
    ptyStreamHub: { isSessionActive: () => true } as unknown as PtyStreamHub,
  })
  expect(
    await control.invoke(
      {
        now: () => new Date(),
        assertActive: () => {
          if (!active) {
            throw new Error('retired')
          }
        },
      },
      {
        id: 'session.stopNode',
        kind: 'command',
        payload: { nodeId: 'node', sessionId: 'session' },
      },
    ),
  ).toMatchObject({ ok: false })
  expect(kill).not.toHaveBeenCalled()
})
