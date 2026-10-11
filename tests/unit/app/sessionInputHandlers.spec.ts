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
