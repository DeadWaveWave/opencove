import React, { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { useScrollbackStore } from '../../../src/contexts/workspace/presentation/renderer/store/useScrollbackStore'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { installMockStorage } from '../../support/persistenceTestStorage'

const NODE_SCROLLBACK_KEY_PREFIX = 'opencove:m0:node-scrollback:'

beforeEach(() => {
  installMockStorage()
  useScrollbackStore.getState().clearAllScrollbacks()
})

function createHarness(
  useHydrateAppStateHook: typeof import('../../../src/app/renderer/shell/hooks/useHydrateAppState').useHydrateAppState,
) {
  return function Harness() {
    const [_agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS)
    const [, setWorkspaces] = useState<WorkspaceState[]>([])
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

    const { isHydrated } = useHydrateAppStateHook({
      activeWorkspaceId,
      setAgentSettings,
      setWorkspaces,
      setActiveWorkspaceId,
    })

    const terminalScrollback = useScrollbackStore(
      state => state.scrollbackByNodeId['terminal-1'] ?? 'none',
    )
    const agentScrollback = useScrollbackStore(
      state => state.scrollbackByNodeId['agent-1'] ?? 'none',
    )

    return (
      <div>
        <div data-testid="hydrated">{String(isHydrated)}</div>
        <div data-testid="terminal-scrollback">{terminalScrollback}</div>
        <div data-testid="agent-scrollback">{agentScrollback}</div>
      </div>
    )
  }
}

describe('useHydrateAppState durable scrollback ownership', () => {
  it('preloads terminal scrollback before runtime hydration completes', async () => {
    const storage = installMockStorage()
    const terminalToken = 'TERMINAL_RESTORE_TOKEN'

    storage.setItem(
      'opencove:m0:workspace-state',
      JSON.stringify({
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            name: 'Workspace 1',
            path: '/tmp/workspace-1',
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            spaces: [],
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-1',
                title: 'terminal-1',
                position: { x: 0, y: 0 },
                width: 520,
                height: 360,
                kind: 'terminal',
                status: null,
                startedAt: null,
                endedAt: null,
                exitCode: null,
                lastError: null,
                scrollback: null,
                agent: null,
                task: null,
              },
            ],
          },
        ],
        settings: {},
      }),
    )
    storage.setItem(`${NODE_SCROLLBACK_KEY_PREFIX}terminal-1`, terminalToken)

    let resolveSpawn: ((value: { sessionId: string }) => void) | null = null
    const spawn = vi.fn(
      () =>
        new Promise<{ sessionId: string }>(resolve => {
          resolveSpawn = resolve
        }),
    )

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: { spawn },
        agent: {
          launch: vi.fn(async () => {
            throw new Error('not used')
          }),
        },
      },
    })

    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')

    render(React.createElement(createHarness(useHydrateAppState)))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent(terminalToken)
    })
    expect(screen.getByTestId('hydrated')).toHaveTextContent('false')

    resolveSpawn?.({ sessionId: 'terminal-session-1' })

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })
  })

  it('skips durable scrollback preload for agent nodes even when stale history exists', async () => {
    const storage = installMockStorage()
    const terminalToken = 'TERMINAL_ONLY_TOKEN'
    const staleAgentToken = 'STALE_AGENT_HISTORY_SHOULD_NOT_RESTORE'

    storage.setItem(
      'opencove:m0:workspace-state',
      JSON.stringify({
        activeWorkspaceId: 'workspace-1',
        workspaces: [
          {
            id: 'workspace-1',
            name: 'Workspace 1',
            path: '/tmp/workspace-1',
            viewport: { x: 0, y: 0, zoom: 1 },
            isMinimapVisible: false,
            spaces: [],
            activeSpaceId: null,
            nodes: [
              {
                id: 'terminal-1',
                title: 'terminal-1',
                position: { x: 0, y: 0 },
                width: 520,
                height: 360,
                kind: 'terminal',
                status: null,
                startedAt: null,
                endedAt: null,
                exitCode: null,
                lastError: null,
                scrollback: null,
                agent: null,
                task: null,
              },
              {
                id: 'agent-1',
                title: 'codex · gpt-5.2-codex',
                position: { x: 40, y: 40 },
                width: 520,
                height: 360,
                kind: 'agent',
                status: 'stopped',
                startedAt: '2026-03-08T09:00:00.000Z',
                endedAt: null,
                exitCode: null,
                lastError: null,
                scrollback: null,
                agent: {
                  provider: 'codex',
                  prompt: '',
                  model: 'gpt-5.2-codex',
                  effectiveModel: 'gpt-5.2-codex',
                  launchMode: 'new',
                  resumeSessionId: null,
                  executionDirectory: '/tmp/workspace-1/agent',
                  expectedDirectory: '/tmp/workspace-1/agent',
                  directoryMode: 'workspace',
                  customDirectory: null,
                  shouldCreateDirectory: false,
                  taskId: null,
                },
                task: null,
              },
            ],
          },
        ],
        settings: {},
      }),
    )
    storage.setItem(`${NODE_SCROLLBACK_KEY_PREFIX}terminal-1`, terminalToken)
    storage.setItem(`${NODE_SCROLLBACK_KEY_PREFIX}agent-1`, staleAgentToken)

    const spawn = vi.fn(async () => ({ sessionId: 'spawned-session' }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: { spawn },
        agent: {
          launch: vi.fn(async () => {
            throw new Error('not used')
          }),
          resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
        },
      },
    })

    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')

    render(React.createElement(createHarness(useHydrateAppState)))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent(terminalToken)
    })
    expect(screen.getByTestId('agent-scrollback')).toHaveTextContent('none')
  })
})
