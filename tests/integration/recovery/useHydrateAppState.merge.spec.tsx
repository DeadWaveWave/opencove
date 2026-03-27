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

describe('useHydrateAppState merge behavior', () => {
  it('shows persisted nodes immediately and preserves user-created nodes while hydration is in-flight', async () => {
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
              id: 'persisted-node-1',
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
    }

    storage.setItem('opencove:m0:workspace-state', JSON.stringify(persistedState))

    const spawnDeferred = createDeferred<{ sessionId: string }>()
    const spawn = vi.fn(() => spawnDeferred.promise)

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

      const addUserNode = useCallback(() => {
        setWorkspaces(previous =>
          previous.map(workspace => {
            if (workspace.id !== 'workspace-1') {
              return workspace
            }

            return {
              ...workspace,
              nodes: [
                ...workspace.nodes,
                {
                  id: 'user-node-1',
                  type: 'terminalNode',
                  position: { x: 12, y: 12 },
                  data: {
                    sessionId: 'user-session',
                    title: 'user-terminal',
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
                    note: null,
                  },
                  draggable: true,
                  selectable: true,
                },
              ],
            }
          }),
        )
      }, [])

      const nodeCount =
        workspaces.find(workspace => workspace.id === 'workspace-1')?.nodes.length ?? 0

      return (
        <div>
          <div data-testid="active-workspace">{activeWorkspaceId ?? 'none'}</div>
          <div data-testid="hydrated">{String(isHydrated)}</div>
          <div data-testid="node-count">{nodeCount}</div>
          <button type="button" onClick={addUserNode}>
            Add node
          </button>
        </div>
      )
    }

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('workspace-1')
    })

    await waitFor(() => {
      expect(screen.getByTestId('node-count')).toHaveTextContent('1')
    })

    expect(screen.getByTestId('hydrated')).toHaveTextContent('false')
    expect(spawn).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add node' }))

    await waitFor(() => {
      expect(screen.getByTestId('node-count')).toHaveTextContent('2')
    })

    spawnDeferred.resolve({ sessionId: 'restored-session' })

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    expect(screen.getByTestId('node-count')).toHaveTextContent('2')
  })

  it('defers inactive workspace hydration until selected and preserves later edits', async () => {
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
              id: 'persisted-node-1',
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
        {
          id: 'workspace-2',
          name: 'Workspace 2',
          path: '/tmp/workspace-2',
          viewport: { x: 0, y: 0, zoom: 1 },
          isMinimapVisible: false,
          spaces: [],
          activeSpaceId: null,
          nodes: [
            {
              id: 'persisted-node-2',
              title: 'terminal-2',
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
    }

    storage.setItem('opencove:m0:workspace-state', JSON.stringify(persistedState))

    const spawnDeferred1 = createDeferred<{ sessionId: string }>()
    const spawnDeferred2 = createDeferred<{ sessionId: string }>()
    const spawn = vi
      .fn()
      .mockImplementationOnce(() => spawnDeferred1.promise)
      .mockImplementationOnce(() => spawnDeferred2.promise)

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

      const addWorkspace2Node = useCallback(() => {
        setWorkspaces(previous =>
          previous.map(workspace => {
            if (workspace.id !== 'workspace-2') {
              return workspace
            }

            return {
              ...workspace,
              nodes: [
                ...workspace.nodes,
                {
                  id: 'user-node-2',
                  type: 'terminalNode',
                  position: { x: 42, y: 42 },
                  data: {
                    sessionId: 'user-session-2',
                    title: 'user-terminal',
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
                    note: null,
                  },
                  draggable: true,
                  selectable: true,
                },
              ],
            }
          }),
        )
      }, [])

      const selectWorkspace2 = useCallback(() => {
        setActiveWorkspaceId('workspace-2')
      }, [])

      const nodeCount1 =
        workspaces.find(workspace => workspace.id === 'workspace-1')?.nodes.length ?? 0
      const nodeCount2 =
        workspaces.find(workspace => workspace.id === 'workspace-2')?.nodes.length ?? 0

      return (
        <div>
          <div data-testid="active-workspace">{activeWorkspaceId ?? 'none'}</div>
          <div data-testid="hydrated">{String(isHydrated)}</div>
          <div data-testid="node-count-1">{nodeCount1}</div>
          <div data-testid="node-count-2">{nodeCount2}</div>
          <button type="button" onClick={addWorkspace2Node}>
            Add node workspace 2
          </button>
          <button type="button" onClick={selectWorkspace2}>
            Select workspace 2
          </button>
        </div>
      )
    }

    render(<Harness />)

    await waitFor(() => {
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('workspace-1')
    })

    await waitFor(() => {
      expect(screen.getByTestId('node-count-1')).toHaveTextContent('1')
    })

    await waitFor(() => {
      expect(screen.getByTestId('node-count-2')).toHaveTextContent('1')
    })

    expect(spawn).toHaveBeenCalledTimes(1)

    spawnDeferred1.resolve({ sessionId: 'restored-session-1' })

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add node workspace 2' }))

    await waitFor(() => {
      expect(screen.getByTestId('node-count-2')).toHaveTextContent('2')
    })

    expect(spawn).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Select workspace 2' }))

    await waitFor(() => {
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('workspace-2')
    })

    await waitFor(() => {
      expect(spawn).toHaveBeenCalledTimes(2)
    })

    spawnDeferred2.resolve({ sessionId: 'restored-session-2' })

    await waitFor(() => {
      expect(screen.getByTestId('node-count-2')).toHaveTextContent('2')
    })
  })
})
