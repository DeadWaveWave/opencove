import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TerminalNodeHeader } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/TerminalNodeHeader'

describe('TerminalNodeHeader agent session actions', () => {
  it('loads session menu items and confirms switching to a selected session', async () => {
    const onSwitchSession = vi.fn(async () => undefined)

    render(
      <TerminalNodeHeader
        title="codex · model"
        kind="agent"
        status="standby"
        agentExecutionDirectory="/repo"
        agentResumeSessionId="session-current"
        agentResumeSessionIdVerified={true}
        onClose={() => undefined}
        onReloadSession={async () => undefined}
        onListSessions={async () => [
          {
            sessionId: 'session-current',
            provider: 'codex',
            cwd: '/repo',
            title: 'Current session',
            startedAt: '2026-04-29T00:00:00.000Z',
            updatedAt: '2026-04-29T00:10:00.000Z',
            source: 'codex-file',
          },
          {
            sessionId: 'session-target',
            provider: 'codex',
            cwd: '/repo/.opencove/worktrees/feat',
            title: 'Target session',
            startedAt: '2026-04-29T00:20:00.000Z',
            updatedAt: '2026-04-29T00:30:00.000Z',
            source: 'codex-file',
          },
        ]}
        onSwitchSession={onSwitchSession}
      />,
    )

    fireEvent.click(screen.getByTestId('terminal-node-session-list'))

    expect(await screen.findByTestId('terminal-node-session-menu')).toBeVisible()
    expect(screen.getByTestId('terminal-node-session-menu-item-session-current')).toBeDisabled()
    expect(screen.getByTestId('terminal-node-session-menu-item-session-target')).toBeEnabled()

    fireEvent.click(screen.getByTestId('terminal-node-session-menu-item-session-target'))

    expect(screen.getByTestId('terminal-node-session-switch-confirm')).toBeVisible()
    fireEvent.click(
      screen.getByTestId('terminal-node-session-switch-confirm-submit-session-target'),
    )

    await waitFor(() => {
      expect(onSwitchSession).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-target',
          cwd: '/repo/.opencove/worktrees/feat',
        }),
      )
    })
  })

  it('disables reload and session list while the agent is restoring', () => {
    render(
      <TerminalNodeHeader
        title="codex · model"
        kind="agent"
        status="restoring"
        agentExecutionDirectory="/repo"
        agentResumeSessionId="session-current"
        agentResumeSessionIdVerified={true}
        onClose={() => undefined}
        onReloadSession={async () => undefined}
        onListSessions={async () => []}
        onSwitchSession={async () => undefined}
      />,
    )

    expect(screen.getByTestId('terminal-node-reload-session')).toBeDisabled()
    expect(screen.getByTestId('terminal-node-session-list')).toBeDisabled()
  })
})
