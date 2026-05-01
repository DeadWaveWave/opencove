import React, { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createHarness(
  useHydrateAppStateHook: typeof import('../../../src/app/renderer/shell/hooks/useHydrateAppState').useHydrateAppState,
) {
  return function Harness() {
    const [_agentSettings, setAgentSettings] = useState(DEFAULT_AGENT_SETTINGS)
    const [workspaces, setWorkspaces] = useState<WorkspaceState[]>([])
    const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null)

    const { isHydrated, isPersistReady } = useHydrateAppStateHook({
      activeWorkspaceId,
      setAgentSettings,
      setWorkspaces,
      setActiveWorkspaceId,
    })

    const activeWorkspace = workspaces.find(workspace => workspace.id === activeWorkspaceId) ?? null
    const terminalNode = activeWorkspace?.nodes.find(node => node.id === 'terminal-1') ?? null
    const agentNode = activeWorkspace?.nodes.find(node => node.id === 'agent-1') ?? null

    const terminalSessionId =
      typeof terminalNode?.data.sessionId === 'string' && terminalNode.data.sessionId.length > 0
        ? terminalNode.data.sessionId
        : 'none'
    const terminalScrollback =
      typeof terminalNode?.data.scrollback === 'string' && terminalNode.data.scrollback.length > 0
        ? terminalNode.data.scrollback
        : 'none'
    const agentScrollback =
      typeof agentNode?.data.scrollback === 'string' && agentNode.data.scrollback.length > 0
        ? agentNode.data.scrollback
        : 'none'

    return (
      <div>
        <div data-testid="active-workspace">{activeWorkspaceId ?? 'none'}</div>
        <div data-testid="persist-ready">{String(isPersistReady)}</div>
        <div data-testid="hydrated">{String(isHydrated)}</div>
        <div data-testid="workspace-node-count">{String(activeWorkspace?.nodes.length ?? 0)}</div>
        <div data-testid="terminal-session-id">{terminalSessionId}</div>
        <div data-testid="terminal-scrollback">{terminalScrollback}</div>
        <div data-testid="agent-scrollback">{agentScrollback}</div>
      </div>
    )
  }
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('useHydrateAppState durable scrollback ownership', () => {
  it('shows the active workspace before delayed terminal scrollback resolves and backfills it while the session is still pending', async () => {
    const terminalToken = 'TERMINAL_RESTORE_TOKEN'
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
    }

    const scrollbackDeferred = createDeferred<string | null>()
    const spawnDeferred = createDeferred<{ sessionId: string }>()
    const readNodeScrollback = vi.fn(async ({ nodeId }: { nodeId: string }) => {
      expect(nodeId).toBe('terminal-1')
      return await scrollbackDeferred.promise
    })
    const spawn = vi.fn(() => spawnDeferred.promise)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: { runtime: 'electron' },
        persistence: {
          readAppState: vi.fn(async () => ({ state: persistedState, recovery: null })),
          readNodeScrollback,
        },
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
      expect(screen.getByTestId('active-workspace')).toHaveTextContent('workspace-1')
    })
    await waitFor(() => {
      expect(screen.getByTestId('workspace-node-count')).toHaveTextContent('1')
    })

    expect(screen.getByTestId('persist-ready')).toHaveTextContent('true')
    expect(screen.getByTestId('hydrated')).toHaveTextContent('false')
    expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('none')
    expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent('none')
    expect(readNodeScrollback).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledTimes(1)

    scrollbackDeferred.resolve(terminalToken)

    await waitFor(() => {
      expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent(terminalToken)
    })
    expect(screen.getByTestId('hydrated')).toHaveTextContent('false')

    spawnDeferred.resolve({ sessionId: 'terminal-session-1' })

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('terminal-session-1')
    expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent(terminalToken)
  })

  it('skips late durable terminal scrollback once runtime hydration has already rebound the session', async () => {
    const durableToken = 'STALE_DURABLE_TERMINAL_HISTORY'
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
    }

    const scrollbackDeferred = createDeferred<string | null>()
    const readNodeScrollbackSettled = vi.fn()
    const readNodeScrollback = vi.fn(async () => {
      const value = await scrollbackDeferred.promise
      readNodeScrollbackSettled()
      return value
    })
    const spawn = vi.fn(async () => ({ sessionId: 'terminal-session-1' }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        persistence: {
          readAppState: vi.fn(async () => ({ state: persistedState, recovery: null })),
          readNodeScrollback,
        },
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
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('terminal-session-1')
    expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent('none')

    scrollbackDeferred.resolve(durableToken)

    await waitFor(() => {
      expect(readNodeScrollbackSettled).toHaveBeenCalledTimes(1)
      expect(screen.getByTestId('terminal-scrollback')).toHaveTextContent('none')
    })
    expect(screen.getByTestId('terminal-session-id')).toHaveTextContent('terminal-session-1')
  })

  it('reads durable scrollback only for terminal nodes and never for agent nodes', async () => {
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
    }

    const readNodeScrollback = vi.fn(async ({ nodeId }: { nodeId: string }) =>
      nodeId === 'terminal-1' ? 'TERMINAL_ONLY_TOKEN' : 'UNEXPECTED_AGENT_TOKEN',
    )
    const spawn = vi.fn(async () => ({ sessionId: 'spawned-session' }))

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        persistence: {
          readAppState: vi.fn(async () => ({ state: persistedState, recovery: null })),
          readNodeScrollback,
        },
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
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    expect(readNodeScrollback).toHaveBeenCalledTimes(1)
    expect(readNodeScrollback).toHaveBeenCalledWith({ nodeId: 'terminal-1' })
    expect(screen.getByTestId('agent-scrollback')).toHaveTextContent('none')
  })
})
