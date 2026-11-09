import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import {
  createPtyEventHub,
  type PtyEventHub,
} from '../../../src/app/renderer/shell/utils/ptyEventHub'
import { useAgentStandbyNotificationWatcher } from '../../../src/app/renderer/shell/hooks/useAgentStandbyNotificationWatcher'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import type { AgentRunSnapshot } from '../../../src/shared/contracts/dto/agentRunState'

const h = vi.hoisted(() => ({ hub: null as PtyEventHub | null }))
vi.mock('../../../src/app/renderer/shell/utils/ptyEventHub', async importOriginal => ({
  ...(await importOriginal<object>()),
  getPtyEventHub: () => h.hub,
}))
vi.mock('../../../src/app/renderer/shell/store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      workspaces: [
        {
          id: 'w',
          path: '/workspace',
          name: 'w',
          nodes: [
            {
              id: 'n',
              data: { kind: 'agent', status: 'running', sessionId: 's', title: 'Agent' },
            },
          ],
        },
      ],
    }),
  },
}))
let send: (event: TerminalSessionStateEvent) => void
let keepAlive: () => void
const now = Date.now() + 1000
function event(state: AgentRunSnapshot['state'], ended?: string): TerminalSessionStateEvent {
  return {
    sessionId: 's',
    state: state === 'idle' ? 'standby' : 'working',
    observedAtMs: now,
    agentRunState: {
      sessionId: 's',
      nodeId: 'n',
      provider: 'codex',
      state,
      blockedReason: null,
      turn: null,
      source: 'session_file',
      quality: 'inferred',
      turnOutcome: ended ? 'completed' : null,
      lastTransitionAt: now,
      lastEndedTurn: ended ? { id: ended, outcome: 'completed', endedAt: now } : null,
    },
  }
}
beforeEach(() => {
  h.hub = createPtyEventHub({
    onData: () => () => {},
    onExit: () => () => {},
    onState: listener => {
      send = listener
      return () => {}
    },
  })
  keepAlive = h.hub.onState(() => {})
})
afterEach(() => {
  cleanup()
  keepAlive()
  h.hub?.dispose()
})
function listen() {
  const standby = vi.fn(),
    working = vi.fn()
  const hook = renderHook(
    ({ enabled }) =>
      useAgentStandbyNotificationWatcher({
        enabled,
        onAgentEnteredStandby: standby,
        onAgentEnteredWorking: working,
      }),
    { initialProps: { enabled: true } },
  )
  return { standby, working, ...hook }
}
it('does not turn a working refresh followed by an idle baseline into completion', () => {
  const f = listen()
  act(() => {
    send(event('working'))
    send(event('idle'))
  })
  expect(f.standby).not.toHaveBeenCalled()
})
it('does not infer completion from the persisted running label on the first idle observation', () => {
  const f = listen()
  act(() => send(event('idle')))
  expect(f.standby).not.toHaveBeenCalled()
})
it('notifies a real end once across duplicate snapshots and later working refreshes', () => {
  const f = listen()
  act(() => {
    send(event('working'))
    send(event('idle', 'turn-1'))
    send(event('idle', 'turn-1'))
  })
  expect(f.standby).toHaveBeenCalledOnce()
  act(() => {
    send(event('working', 'turn-1'))
    send(event('idle', 'turn-1'))
  })
  expect(f.standby).toHaveBeenCalledOnce()
  act(() => send(event('idle', 'turn-2')))
  expect(f.standby).toHaveBeenCalledTimes(2)
})
it('seeds cached completion as a baseline even when its clock is ahead of the renderer', () => {
  send(event('idle', 'old'))
  const f = listen()
  expect(f.standby).not.toHaveBeenCalled()
  act(() => send(event('idle', 'old')))
  expect(f.standby).not.toHaveBeenCalled()
  act(() => send(event('idle', 'new')))
  expect(f.standby).toHaveBeenCalledOnce()
})
it('reenabling notifications does not replay a turn completed while disabled', () => {
  const f = listen()
  f.rerender({ enabled: false })
  act(() => send(event('idle', 'disabled')))
  f.rerender({ enabled: true })
  expect(f.standby).not.toHaveBeenCalled()
  act(() => send(event('idle', 'next')))
  expect(f.standby).toHaveBeenCalledOnce()
})
