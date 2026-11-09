import { expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionInputHandlers } from '../../../src/app/main/controlSurface/handlers/sessionInputHandlers'
import type { PtyStreamHub } from '../../../src/app/main/controlSurface/ptyStream/ptyStreamHub'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

async function fixture(kind: 'terminal' | 'agent' = 'terminal') {
  const store = createInMemoryPersistenceStore()
  const state = createMinimalState('/repo', 'project', 'space')
  state.workspaces[0].nodes = [
    {
      id: 'node',
      kind,
      sessionId: 'shell',
      title: 'Reviewer',
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
  let observation: { nodeId: string; sessionId: string; state: string; quality?: string } | null = {
    nodeId: 'node',
    sessionId: 'shell',
    state: 'idle',
  }
  const kill = vi.fn(),
    writeAutomation = vi.fn()
  const surface = createControlSurface()
  let duringRead = () => {}
  registerSessionInputHandlers(surface, {
    getPersistenceStore: async () => {
      duringRead()
      return store
    },
    ptyRuntime: { kill },
    ptyStreamHub: {
      isSessionActive: () => true,
      observeAgentState: () => observation,
      writeAutomation,
    } as unknown as PtyStreamHub,
  })
  return {
    kill,
    writeAutomation,
    store,
    state,
    observe: (value: typeof observation) => {
      observation = value
    },
    duringRead: (callback: () => void) => {
      duringRead = callback
    },
    stop: (agentOnly = true) =>
      surface.invoke(
        { now: () => new Date() },
        {
          id: 'session.stopNode',
          kind: 'command',
          payload: { nodeId: 'node', sessionId: 'shell', ...(agentOnly ? { agentOnly } : {}) },
        },
      ),
  }
}

it.each(['shell prompt', 'unrelated foreground build'])(
  'does not kill %s after the observed agent exits',
  async () => {
    const f = await fixture()
    f.observe({ nodeId: 'node', sessionId: 'shell', state: 'exited' })
    expect(await f.stop()).toMatchObject({
      ok: true,
      value: { stopped: false, reason: 'not_running' },
    })
    expect(f.kill).not.toHaveBeenCalled()
    expect(f.writeAutomation).not.toHaveBeenCalled()
    expect(await f.store.readAppState()).toEqual(f.state)
  },
)

it('rechecks agent exit after awaiting the durable binding, before killing the shell', async () => {
  const f = await fixture()
  f.duringRead(() => f.observe({ nodeId: 'node', sessionId: 'shell', state: 'exited' }))
  expect(await f.stop()).toMatchObject({
    ok: true,
    value: { stopped: false, reason: 'not_running' },
  })
  expect(f.kill).not.toHaveBeenCalled()
})

it('refuses a live plain shell even when called directly without CLI checks', async () => {
  const f = await fixture()
  f.observe(null)
  expect(await f.stop()).toMatchObject({ ok: false, error: { code: 'agent.not_running' } })
  expect(f.kill).not.toHaveBeenCalled()
})

it('reports a mismatched Worker observation as a binding change', async () => {
  const f = await fixture()
  f.observe({ nodeId: 'replacement', sessionId: 'shell', state: 'idle' })
  expect(await f.stop()).toMatchObject({ ok: false, error: { code: 'common.invalid_input' } })
  expect(f.kill).not.toHaveBeenCalled()
})

it('stops a current live observed agent', async () => {
  const f = await fixture()
  expect(await f.stop()).toMatchObject({ ok: true, value: { stopped: true } })
  expect(f.kill).toHaveBeenCalledExactlyOnceWith('shell')
})

it('preserves generic stopNode support for a plain terminal', async () => {
  const f = await fixture()
  f.observe(null)
  expect(await f.stop(false)).toMatchObject({ ok: true, value: { stopped: true } })
  expect(f.kill).toHaveBeenCalledExactlyOnceWith('shell')
})

it('does not treat uncertain terminal observations as proof that an agent is live', async () => {
  const f = await fixture()
  f.observe({ nodeId: 'node', sessionId: 'shell', state: 'unknown' })
  expect(await f.stop()).toMatchObject({ ok: false, error: { code: 'agent.state_unknown' } })
  expect(f.kill).not.toHaveBeenCalled()
})

it('does not kill a shell based on degraded live-agent evidence', async () => {
  const f = await fixture()
  f.observe({ nodeId: 'node', sessionId: 'shell', state: 'working', quality: 'degraded' })
  expect(await f.stop()).toMatchObject({ ok: false, error: { code: 'agent.state_unknown' } })
  expect(f.kill).not.toHaveBeenCalled()
})
