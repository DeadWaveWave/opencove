import React, { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { installMockStorage } from '../../support/persistenceTestStorage'

describe('useHydrateAppState terminal profile recovery', () => {
  it('rehydrates a terminal using the persisted node profile instead of the current settings default', async () => {
    const storage = installMockStorage()

    storage.setItem(
      'opencove:m0:workspace-state',
      JSON.stringify({
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            name: 'Workspace 1',
            path: 'C:\\repo',
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: true,
            spaces: [],
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-node-1',
                title: 'terminal-1',
                position: { x: 0, y: 0 },
                width: 520,
                height: 360,
                kind: 'terminal',
                profileId: 'wsl:ubuntu',
                runtimeKind: 'wsl',
                status: null,
                startedAt: null,
                endedAt: null,
                exitCode: null,
                lastError: null,
                scrollback: null,
                executionDirectory: 'C:\\repo',
                expectedDirectory: 'C:\\repo',
                agent: null,
                task: null,
              },
            ],
          },
        ],
        settings: {
          defaultTerminalProfileId: 'powershell',
        },
      }),
    )

    const spawn = vi.fn(async () => ({
      sessionId: 'terminal-session-1',
      profileId: 'wsl:Ubuntu',
      runtimeKind: 'wsl' as const,
    }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: { spawn },
        agent: {
          launch: vi.fn(),
          resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
        },
      },
    })

    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')

    function Harness() {
      const [_agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS)
      const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([])
      const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

      const { isHydrated } = useHydrateAppState({
        activeWorkspaceId,
        setAgentSettings,
        setWorkspaces,
        setActiveWorkspaceId,
      })

      const workspace = workspaces.find(item => item.id === 'workspace-1') ?? null
      const terminalNode = workspace?.nodes.find(node => node.id === 'terminal-node-1') ?? null

      return (
        <div>
          <div data-testid="hydrated">{String(isHydrated)}</div>
          <div data-testid="terminal-session-id">{terminalNode?.data.sessionId ?? 'none'}</div>
          <div data-testid="terminal-profile-id">
            {String(terminalNode?.data.profileId ?? 'none')}
          </div>
          <div data-testid="terminal-runtime-kind">
            {String(terminalNode?.data.runtimeKind ?? 'none')}
          </div>
        </div>
      )
    }

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    expect(spawn).toHaveBeenCalledWith({
      cwd: 'C:\\repo',
      profileId: 'wsl:ubuntu',
      cols: 80,
      rows: 24,
    })
    expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('terminal-session-1')
    expect(screen.getByTestId('terminal-profile-id')).toHaveTextContent('wsl:Ubuntu')
    expect(screen.getByTestId('terminal-runtime-kind')).toHaveTextContent('wsl')
  })
})
