import React, { useCallback, useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { installMockStorage } from '../../support/persistenceTestStorage'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

describe('useHydrateAppState runtime field merge', () => {
  it('preserves user-edited runtime ownership fields when hydration resolves late', async () => {
    const storage = installMockStorage()

    const persistedState = {
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
              id: 'terminal-node-1',
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
              executionDirectory: '/tmp/workspace-1',
              expectedDirectory: '/tmp/workspace-1',
              agent: null,
              task: null,
            },
            {
              id: 'agent-node-1',
              title: 'codex · gpt-5.2-codex',
              position: { x: 48, y: 48 },
              width: 520,
              height: 360,
              kind: 'agent',
              status: 'standby',
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
    }

    storage.setItem('opencove:m0:workspace-state', JSON.stringify(persistedState))

    const terminalSpawnDeferred = createDeferred<{ sessionId: string }>()
    const agentLaunchDeferred = createDeferred<{
      sessionId: string
      provider: 'codex'
      command: string
      args: string[]
      launchMode: 'new'
      effectiveModel: string
      resumeSessionId: null
    }>()

    const spawn = vi.fn(() => terminalSpawnDeferred.promise)
    const launch = vi.fn(() => agentLaunchDeferred.promise)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        pty: { spawn },
        agent: {
          launch,
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

      const applyUserEdits = useCallback(() => {
        setWorkspaces(previous =>
          previous.map(workspace => {
            if (workspace.id !== 'workspace-1') {
              return workspace
            }

            return {
              ...workspace,
              nodes: workspace.nodes.map(node => {
                if (node.id === 'terminal-node-1') {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      executionDirectory: '/tmp/space-a',
                      expectedDirectory: '/tmp/space-a',
                    },
                  }
                }

                if (node.id === 'agent-node-1' && node.data.agent) {
                  return {
                    ...node,
                    data: {
                      ...node.data,
                      agent: {
                        ...node.data.agent,
                        taskId: 'task-1',
                        executionDirectory: '/tmp/space-b',
                        expectedDirectory: '/tmp/space-b',
                      },
                    },
                  }
                }

                return node
              }),
            }
          }),
        )
      }, [])

      const workspace = workspaces.find(item => item.id === 'workspace-1') ?? null
      const terminalNode = workspace?.nodes.find(node => node.id === 'terminal-node-1') ?? null
      const agentNode = workspace?.nodes.find(node => node.id === 'agent-node-1') ?? null

      return (
        <div>
          <div data-testid="hydrated">{String(isHydrated)}</div>
          <div data-testid="terminal-session-id">{terminalNode?.data.sessionId ?? 'none'}</div>
          <div data-testid="terminal-execution-directory">
            {String(terminalNode?.data.executionDirectory ?? 'none')}
          </div>
          <div data-testid="terminal-expected-directory">
            {String(terminalNode?.data.expectedDirectory ?? 'none')}
          </div>
          <div data-testid="agent-session-id">{agentNode?.data.sessionId ?? 'none'}</div>
          <div data-testid="agent-task-id">{agentNode?.data.agent?.taskId ?? 'none'}</div>
          <div data-testid="agent-execution-directory">
            {String(agentNode?.data.agent?.executionDirectory ?? 'none')}
          </div>
          <div data-testid="agent-expected-directory">
            {String(agentNode?.data.agent?.expectedDirectory ?? 'none')}
          </div>
          <button type="button" onClick={applyUserEdits}>
            Apply user edits
          </button>
        </div>
      )
    }

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('none')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Apply user edits' }))

    await waitFor(() => {
      expect(screen.getByTestId('terminal-execution-directory')).toHaveTextContent('/tmp/space-a')
    })

    await waitFor(() => {
      expect(screen.getByTestId('agent-task-id')).toHaveTextContent('task-1')
    })

    terminalSpawnDeferred.resolve({ sessionId: 'terminal-session-1' })
    agentLaunchDeferred.resolve({
      sessionId: 'agent-session-1',
      provider: 'codex',
      command: 'codex',
      args: [],
      launchMode: 'new',
      effectiveModel: 'gpt-5.2-codex',
      resumeSessionId: null,
    })

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('terminal-session-1')
    expect(screen.getByTestId('terminal-execution-directory')).toHaveTextContent('/tmp/space-a')
    expect(screen.getByTestId('terminal-expected-directory')).toHaveTextContent('/tmp/space-a')
    expect(screen.getByTestId('agent-session-id')).toHaveTextContent('agent-session-1')
    expect(screen.getByTestId('agent-task-id')).toHaveTextContent('task-1')
    expect(screen.getByTestId('agent-execution-directory')).toHaveTextContent('/tmp/space-b')
    expect(screen.getByTestId('agent-expected-directory')).toHaveTextContent('/tmp/space-b')
    expect(spawn).toHaveBeenCalledTimes(1)
    expect(launch).toHaveBeenCalledTimes(1)
  })
})
