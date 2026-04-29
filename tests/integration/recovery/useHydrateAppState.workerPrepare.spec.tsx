import React, { useState } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { installMockStorage } from '../../support/persistenceTestStorage'

function createDeferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void

  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  return { promise, resolve, reject }
}

function createPersistedState() {
  return {
    activeWorkspaceId: 'workspace-1',
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace 1',
        path: '/tmp/workspace-1',
        worktreesRoot: '/tmp/workspace-1',
        environmentVariables: { OPENAI_API_KEY: 'persisted-key' },
        pullRequestBaseBranchOptions: [],
        spaceArchiveRecords: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: false,
        spaces: [],
        activeSpaceId: null,
        nodes: [
          {
            id: 'agent-node-1',
            title: 'codex · gpt-5.2-codex',
            position: { x: 0, y: 0 },
            width: 520,
            height: 360,
            kind: 'agent',
            sessionId: 'stale-session-id',
            status: 'running',
            startedAt: '2026-04-24T10:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: 'persisted agent history',
            profileId: null,
            terminalGeometry: { cols: 64, rows: 44 },
            agent: {
              provider: 'codex',
              prompt: 'recover agent',
              model: 'gpt-5.2-codex',
              effectiveModel: 'gpt-5.2-codex',
              launchMode: 'resume',
              resumeSessionId: 'resume-session-1',
              resumeSessionIdVerified: true,
              executionDirectory: '/tmp/workspace-1',
              expectedDirectory: '/tmp/workspace-1',
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

    const hydratedAgent = workspaces.find(workspace => workspace.id === 'workspace-1')?.nodes[0]

    return (
      <div>
        <div data-testid="hydrated">{String(isHydrated)}</div>
        <div data-testid="persist-ready">{String(isPersistReady)}</div>
        <div data-testid="node-count">
          {String(workspaces.find(workspace => workspace.id === 'workspace-1')?.nodes.length ?? 0)}
        </div>
        <div data-testid="agent-session-id">{hydratedAgent?.data.sessionId ?? ''}</div>
        <div data-testid="agent-status">{hydratedAgent?.data.status ?? 'none'}</div>
        <div data-testid="agent-live-reattach">
          {String(hydratedAgent?.data.isLiveSessionReattach === true)}
        </div>
      </div>
    )
  }
}

describe('useHydrateAppState worker prepare', () => {
  it('prefers the worker prepare/revive path for the initial active workspace', async () => {
    const storage = installMockStorage()
    storage.setItem('opencove:m0:workspace-state', JSON.stringify(createPersistedState()))

    const spawn = vi.fn(async () => ({ sessionId: 'should-not-spawn' }))
    const launch = vi.fn(async () => ({ sessionId: 'should-not-launch' }))
    const controlSurfaceInvoke = vi.fn(async request => {
      expect(request).toMatchObject({
        kind: 'command',
        id: 'session.prepareOrRevive',
        payload: {
          workspaceId: 'workspace-1',
          nodeIds: ['agent-node-1'],
        },
      })

      return {
        workspaceId: 'workspace-1',
        nodes: [
          {
            nodeId: 'agent-node-1',
            kind: 'agent',
            recoveryState: 'live',
            sessionId: 'live-session-id',
            isLiveSessionReattach: true,
            title: 'codex · gpt-5.2-codex',
            profileId: null,
            runtimeKind: 'posix',
            status: 'running',
            startedAt: '2026-04-24T10:00:00.000Z',
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: 'persisted agent history',
            executionDirectory: '/tmp/workspace-1',
            expectedDirectory: '/tmp/workspace-1',
            terminalGeometry: { cols: 64, rows: 44 },
            agent: {
              provider: 'codex',
              prompt: 'recover agent',
              model: 'gpt-5.2-codex',
              effectiveModel: 'gpt-5.2-codex',
              launchMode: 'resume',
              resumeSessionId: 'resume-session-1',
              resumeSessionIdVerified: true,
              executionDirectory: '/tmp/workspace-1',
              expectedDirectory: '/tmp/workspace-1',
              directoryMode: 'workspace',
              customDirectory: null,
              shouldCreateDirectory: false,
              taskId: null,
            },
          },
        ],
      }
    })

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          runtime: 'electron',
          platform: 'darwin',
          isTest: true,
          isPackaged: false,
          allowWhatsNewInTests: true,
          mainPid: 123,
          windowsPty: null,
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
        pty: {
          spawn,
          snapshot: vi.fn(async () => ({ data: 'legacy snapshot' })),
        },
        agent: {
          launch,
          resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
        },
      },
    })

    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')

    render(React.createElement(createHarness(useHydrateAppState)))

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    expect(screen.getByTestId('agent-session-id')).toHaveTextContent('live-session-id')
    expect(screen.getByTestId('agent-status')).toHaveTextContent('running')
    expect(screen.getByTestId('agent-live-reattach')).toHaveTextContent('true')
    expect(controlSurfaceInvoke).toHaveBeenCalledTimes(1)
    expect(spawn).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('shows the active workspace before worker prepare resolves without using local recovery', async () => {
    const storage = installMockStorage()
    storage.setItem('opencove:m0:workspace-state', JSON.stringify(createPersistedState()))

    const prepareDeferred = createDeferred<{
      workspaceId: string
      nodes: Array<{
        nodeId: string
        kind: 'agent'
        recoveryState: 'live'
        sessionId: string
        isLiveSessionReattach: boolean
        title: string
        profileId: null
        runtimeKind: 'posix'
        status: 'running'
        startedAt: string
        endedAt: null
        exitCode: null
        lastError: null
        scrollback: string
        executionDirectory: string
        expectedDirectory: string
        terminalGeometry: { cols: number; rows: number } | null
        agent: NonNullable<
          ReturnType<typeof createPersistedState>['workspaces'][number]['nodes'][number]['agent']
        >
      }>
    }>()
    const spawn = vi.fn(async () => ({ sessionId: 'should-not-spawn' }))
    const launch = vi.fn(async () => ({ sessionId: 'should-not-launch' }))
    const controlSurfaceInvoke = vi.fn(() => prepareDeferred.promise)

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          runtime: 'electron',
          platform: 'darwin',
          isTest: true,
          isPackaged: false,
          allowWhatsNewInTests: true,
          mainPid: 123,
          windowsPty: null,
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
        pty: {
          spawn,
          snapshot: vi.fn(async () => ({ data: 'legacy snapshot' })),
        },
        agent: {
          launch,
          resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
        },
      },
    })

    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')

    render(React.createElement(createHarness(useHydrateAppState)))

    await waitFor(() => {
      expect(screen.getByTestId('persist-ready')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('hydrated')).toHaveTextContent('false')
    expect(screen.getByTestId('node-count')).toHaveTextContent('1')
    expect(screen.getByTestId('agent-session-id')).toHaveTextContent('')
    expect(controlSurfaceInvoke).toHaveBeenCalledTimes(1)
    expect(spawn).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()

    const persistedAgent = createPersistedState().workspaces[0]?.nodes[0]?.agent
    if (!persistedAgent) {
      throw new Error('expected persisted agent fixture')
    }

    prepareDeferred.resolve({
      workspaceId: 'workspace-1',
      nodes: [
        {
          nodeId: 'agent-node-1',
          kind: 'agent',
          recoveryState: 'live',
          sessionId: 'live-session-id',
          isLiveSessionReattach: true,
          title: 'codex · gpt-5.2-codex',
          profileId: null,
          runtimeKind: 'posix',
          status: 'running',
          startedAt: '2026-04-24T10:00:00.000Z',
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: 'persisted agent history',
          executionDirectory: '/tmp/workspace-1',
          expectedDirectory: '/tmp/workspace-1',
          terminalGeometry: { cols: 64, rows: 44 },
          agent: persistedAgent,
        },
      ],
    })

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })
    expect(screen.getByTestId('agent-session-id')).toHaveTextContent('live-session-id')
    expect(screen.getByTestId('agent-live-reattach')).toHaveTextContent('true')
    expect(spawn).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('does not fall back to local runtime hydration when worker prepare fails in electron', async () => {
    const storage = installMockStorage()
    storage.setItem('opencove:m0:workspace-state', JSON.stringify(createPersistedState()))

    const spawn = vi.fn(async () => ({ sessionId: 'should-not-spawn' }))
    const launch = vi.fn(async () => ({ sessionId: 'should-not-launch' }))
    const controlSurfaceInvoke = vi.fn(async () => {
      throw new Error('worker unavailable')
    })

    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      writable: true,
      value: {
        meta: {
          runtime: 'electron',
          platform: 'darwin',
          isTest: true,
          isPackaged: false,
          allowWhatsNewInTests: true,
          mainPid: 123,
          windowsPty: null,
        },
        controlSurface: {
          invoke: controlSurfaceInvoke,
        },
        pty: {
          spawn,
          snapshot: vi.fn(async () => ({ data: 'legacy snapshot' })),
        },
        agent: {
          launch,
          resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
        },
      },
    })

    const { useHydrateAppState } =
      await import('../../../src/app/renderer/shell/hooks/useHydrateAppState')

    render(React.createElement(createHarness(useHydrateAppState)))

    await waitFor(() => {
      expect(screen.getByTestId('hydrated')).toHaveTextContent('true')
    })

    expect(screen.getByTestId('agent-session-id')).toHaveTextContent('')
    expect(spawn).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })
})
