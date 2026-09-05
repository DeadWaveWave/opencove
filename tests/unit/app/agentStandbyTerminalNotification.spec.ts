import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TerminalSessionStateEvent } from '../../../src/shared/contracts/dto'
import { useAgentStandbyNotificationWatcher } from '../../../src/app/renderer/shell/hooks/useAgentStandbyNotificationWatcher'

const harness = vi.hoisted(() => ({
  kind: 'agent' as 'agent' | 'terminal',
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
                status: harness.kind === 'agent' ? 'running' : null,
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
