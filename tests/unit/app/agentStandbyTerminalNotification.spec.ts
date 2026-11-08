import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import { useAgentStandbyNotificationWatcher } from '../../../src/app/renderer/shell/hooks/useAgentStandbyNotificationWatcher'

const harness = vi.hoisted(() => ({
  kind: 'agent' as 'agent' | 'terminal',
  status: 'running' as 'running' | 'restoring',
  overlay: 'active' as 'active' | 'exited' | 'none',
  onState: null as ((event: TerminalSessionStateEvent) => void) | null,
}))

vi.mock('../../../src/app/renderer/shell/store/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          path: '/workspace',
          nodes: [
            {
              id: 'node',
              data: {
                kind: harness.kind,
                sessionId: 'pty',
                title: 'Codex',
                status: harness.kind === 'agent' ? harness.status : null,
                agent: null,
                agentOverlay:
                  harness.kind === 'terminal' && harness.overlay !== 'none'
                    ? {
                        provider: 'codex',
                        status: 'running',
                        startedAtMs: 1,
                        activity: { phase: harness.overlay },
                      }
                    : null,
                terminalAgentBinding: {
                  provider: 'codex',
                  resumeSessionId: 'old-session',
                  resumeSessionIdVerified: true,
                },
              },
            },
          ],
        },
      ],
    }),
  },
}))
vi.mock('../../../src/app/renderer/shell/utils/ptyEventHub', () => ({
  getPtyEventHub: () => ({
    onState: (listener: (event: TerminalSessionStateEvent) => void) => {
      harness.onState = listener
      return () => {
        harness.onState = null
      }
    },
  }),
}))

afterEach(cleanup)
beforeEach(() => {
  harness.overlay = 'active'
  harness.status = 'running'
})

describe('Agent completion notification entry points', () => {
  it.each(['agent', 'terminal'] as const)(
    'notifies when a live %s Agent completes a turn',
    kind => {
      harness.kind = kind
      const onAgentEnteredStandby = vi.fn()
      renderHook(() =>
        useAgentStandbyNotificationWatcher({
          onAgentEnteredStandby,
          onAgentEnteredWorking: vi.fn(),
        }),
      )
      act(() => {
        harness.onState?.({ sessionId: 'pty', state: 'working', source: 'codex_hook' })
        harness.onState?.({ sessionId: 'pty', state: 'standby', source: 'codex_hook' })
      })
      expect(onAgentEnteredStandby).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          sessionId: 'pty',
          nodeId: 'node',
          title: 'Codex',
        }),
      )
      act(() => harness.onState?.({ sessionId: 'pty', state: 'standby' }))
      expect(onAgentEnteredStandby).toHaveBeenCalledTimes(1)
      act(() => {
        harness.onState?.({ sessionId: 'pty', state: 'working' })
        harness.onState?.({ sessionId: 'pty', state: 'standby' })
      })
      expect(onAgentEnteredStandby).toHaveBeenCalledTimes(2)
    },
  )

  it.each(['none', 'exited'] as const)(
    'ignores %s terminal overlays even with a retained binding',
    overlay => {
      harness.kind = 'terminal'
      harness.overlay = overlay
      const onAgentEnteredStandby = vi.fn()
      renderHook(() =>
        useAgentStandbyNotificationWatcher({
          onAgentEnteredStandby,
          onAgentEnteredWorking: vi.fn(),
        }),
      )
      act(() => {
        harness.onState?.({ sessionId: 'pty', state: 'working' })
        harness.onState?.({ sessionId: 'pty', state: 'standby' })
      })
      expect(onAgentEnteredStandby).not.toHaveBeenCalled()
    },
  )

  it('uses the live terminal projection when the working event preceded subscription', () => {
    harness.kind = 'terminal'
    const onAgentEnteredStandby = vi.fn()
    renderHook(() =>
      useAgentStandbyNotificationWatcher({ onAgentEnteredStandby, onAgentEnteredWorking: vi.fn() }),
    )
    act(() => harness.onState?.({ sessionId: 'pty', state: 'standby' }))
    expect(onAgentEnteredStandby).toHaveBeenCalledOnce()
  })
})

// Legacy UI contract (e2e: agent-status-watcher "first observed state is standby"): an unknown
// decided state is skipped, and the first standby after it still notifies.
it('still notifies when the first decided state after an unknown projection is idle', () => {
  harness.kind = 'agent'
  const onAgentEnteredStandby = vi.fn()
  const onAgentEnteredWorking = vi.fn()
  renderHook(() =>
    useAgentStandbyNotificationWatcher({ onAgentEnteredStandby, onAgentEnteredWorking }),
  )
  const snapshot = {
    sessionId: 'pty',
    nodeId: 'node',
    provider: 'codex' as const,
    state: 'unknown' as const,
    blockedReason: null,
    turn: null,
    turnOutcome: null,
    lastTransitionAt: 1,
    source: null,
    quality: 'degraded' as const,
  }
  act(() => {
    harness.onState?.({ sessionId: 'pty', state: 'working', agentRunState: snapshot })
    harness.onState?.({
      sessionId: 'pty',
      state: 'standby',
      agentRunState: { ...snapshot, state: 'idle', quality: 'inferred', source: 'session_file' },
    })
  })
  expect(onAgentEnteredWorking).not.toHaveBeenCalled()
  expect(onAgentEnteredStandby).toHaveBeenCalledTimes(1)
})

describe('Agents already waiting at startup', () => {
  it('are a baseline when their wait began before the watcher listened', () => {
    harness.kind = 'agent'
    const onAgentEnteredStandby = vi.fn()
    renderHook(() =>
      useAgentStandbyNotificationWatcher({ onAgentEnteredStandby, onAgentEnteredWorking: vi.fn() }),
    )
    act(() =>
      harness.onState?.({ sessionId: 'pty', state: 'standby', observedAtMs: Date.now() - 60_000 }),
    )
    expect(onAgentEnteredStandby).not.toHaveBeenCalled()

    act(() => {
      harness.onState?.({ sessionId: 'pty', state: 'working', observedAtMs: Date.now() })
      harness.onState?.({ sessionId: 'pty', state: 'standby', observedAtMs: Date.now() })
    })
    expect(onAgentEnteredStandby).toHaveBeenCalledOnce()
  })

  it('are a baseline while they are being restored', () => {
    harness.kind = 'agent'
    harness.status = 'restoring'
    const onAgentEnteredStandby = vi.fn()
    renderHook(() =>
      useAgentStandbyNotificationWatcher({ onAgentEnteredStandby, onAgentEnteredWorking: vi.fn() }),
    )
    act(() => harness.onState?.({ sessionId: 'pty', state: 'standby' }))
    expect(onAgentEnteredStandby).not.toHaveBeenCalled()
  })

  it('still announce a wait that began after the watcher listened', () => {
    harness.kind = 'agent'
    const onAgentEnteredStandby = vi.fn()
    renderHook(() =>
      useAgentStandbyNotificationWatcher({ onAgentEnteredStandby, onAgentEnteredWorking: vi.fn() }),
    )
    act(() =>
      harness.onState?.({ sessionId: 'pty', state: 'standby', observedAtMs: Date.now() + 5 }),
    )
    expect(onAgentEnteredStandby).toHaveBeenCalledOnce()
  })
})
