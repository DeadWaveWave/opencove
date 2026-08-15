import { describe, expect, it, vi } from 'vitest'
import { logAgentLaunchInfo } from '../../../src/app/main/diagnostics/agentLaunchRuntimeDiagnostics'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import {
  prepareAgentNode,
  prepareTerminalNode,
} from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type {
  NormalizedPersistedNode,
  NormalizedPersistedSpace,
  NormalizedPersistedWorkspace,
} from '../../../src/platform/persistence/sqlite/normalize'

vi.mock('../../../src/app/main/diagnostics/agentLaunchRuntimeDiagnostics', () => ({
  logAgentLaunchInfo: vi.fn(),
  logAgentLaunchError: vi.fn(),
}))

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-08-15T00:00:00.000Z'),
  capabilities: {
    webShell: false,
    sync: { state: true, events: true },
    sessionStreaming: {
      enabled: true,
      ptyProtocolVersion: 1,
      replayWindowMaxBytes: 400_000,
      roles: { viewer: true, controller: true },
      webAuth: { ticketToCookie: true, cookieSession: true },
    },
  },
}

function createNode(
  overrides: Partial<NormalizedPersistedNode> & {
    workerBinding?: { endpointId: string; mountId: string | null } | null
  } = {},
): NormalizedPersistedNode {
  return {
    id: 'node-1',
    sessionId: null,
    title: 'terminal',
    position: { x: 0, y: 0 },
    width: 520,
    height: 360,
    kind: 'terminal',
    profileId: null,
    runtimeKind: 'posix',
    terminalGeometry: null,
    terminalProviderHint: null,
    labelColorOverride: null,
    sidebarSortOrder: null,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    executionDirectory: '/remote/repo',
    expectedDirectory: '/remote/repo',
    agent: null,
    task: null,
    scrollback: null,
    ...overrides,
  } as NormalizedPersistedNode
}

function createSpace(overrides: Partial<NormalizedPersistedSpace> = {}): NormalizedPersistedSpace {
  return {
    id: 'space-1',
    name: 'Main',
    directoryPath: '/local/repo',
    targetMountId: 'mount-local',
    parentSpaceId: null,
    boundary: {
      allowedMountIds: null,
      scopesByMountId: null,
      allowedPluginIds: null,
      capabilities: null,
      trustLevel: null,
    },
    sortOrder: 0,
    pinned: false,
    labelColor: null,
    nodeIds: ['node-1'],
    rect: null,
    ...overrides,
  }
}

function createWorkspace(space: NormalizedPersistedSpace | null): NormalizedPersistedWorkspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    iconId: null,
    path: '/local/repo',
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    environmentVariables: {},
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: space ? [space] : [],
    activeSpaceId: space?.id ?? null,
    nodes: [],
  }
}

function mount(mountId: string, endpointId: string, rootPath: string): Record<string, unknown> {
  return {
    mountId,
    projectId: 'workspace-1',
    name: mountId,
    sortOrder: 0,
    endpointId,
    targetId: `target-${mountId}`,
    rootPath,
    rootUri: `file://${rootPath}`,
    createdAt: '2026-08-15T00:00:00.000Z',
    updatedAt: '2026-08-15T00:00:00.000Z',
  }
}

describe('session prepare/revive node-owned worker binding', () => {
  it('prefers the node remote binding over a conflicting Space mount', async () => {
    const invoked: string[] = []
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        invoked.push(request.id)
        if (request.id === 'mount.list') {
          return {
            ok: true,
            value: {
              projectId: 'workspace-1',
              mounts: [
                mount('mount-local', 'local', '/local/repo'),
                mount('mount-remote', 'endpoint-remote', '/remote/repo'),
              ],
            },
          }
        }

        expect(request.id).toBe('pty.spawnInMount')
        expect(request.payload).toMatchObject({
          mountId: 'mount-remote',
          cwdUri: 'file:///remote/repo',
        })
        return {
          ok: true,
          value: { sessionId: 'remote-session', profileId: null, runtimeKind: 'posix' },
        }
      }),
    } as ControlSurface
    const space = createSpace()

    const prepared = await prepareTerminalNode({
      controlSurface,
      ctx,
      ptyRuntime: { write: vi.fn() } as never,
      store: { readNodeScrollback: vi.fn(async () => null) } as never,
      workspace: createWorkspace(space),
      node: createNode({
        workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-remote' },
      }),
      space,
    })

    expect(prepared.sessionId).toBe('remote-session')
    expect(prepared.workerBinding).toEqual({
      endpointId: 'endpoint-remote',
      mountId: 'mount-remote',
    })
    expect(invoked).not.toContain('pty.spawn')
  })

  it('fails closed without a local PTY when a terminal remote binding is unresolved', async () => {
    const invoked: string[] = []
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        invoked.push(request.id)
        if (request.id === 'mount.list') {
          return { ok: true, value: { projectId: 'workspace-1', mounts: [] } }
        }
        return {
          ok: true,
          value: { sessionId: 'must-not-launch', profileId: null, runtimeKind: 'posix' },
        }
      }),
    } as ControlSurface

    const prepared = await prepareTerminalNode({
      controlSurface,
      ctx,
      ptyRuntime: { write: vi.fn() } as never,
      store: { readNodeScrollback: vi.fn(async () => null) } as never,
      workspace: createWorkspace(null),
      node: createNode({
        workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-missing' },
      }),
      space: null,
    })

    expect(prepared).toMatchObject({
      recoveryState: 'fallback_terminal',
      sessionId: '',
      recoveryIssue: 'remote_worker_unavailable',
    })
    expect(invoked).toEqual(['mount.list'])
  })

  it('fails closed without a local launch when an agent remote binding is unresolved', async () => {
    const invoked: string[] = []
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        invoked.push(request.id)
        return { ok: true, value: { projectId: 'workspace-1', mounts: [] } }
      }),
    } as ControlSurface
    const node = createNode({
      kind: 'agent',
      status: 'running',
      workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-missing' },
    })

    const prepared = await prepareAgentNode({
      controlSurface,
      ctx,
      store: {} as never,
      workspace: createWorkspace(null),
      node,
      space: null,
      agent: {
        provider: 'claude-code',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'resume',
        resumeSessionId: 'resume-1',
        resumeSessionIdVerified: true,
        executionDirectory: '/remote/repo',
        expectedDirectory: '/remote/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      settings: DEFAULT_AGENT_SETTINGS,
    })

    expect(prepared).toMatchObject({
      kind: 'agent',
      recoveryState: 'fallback_terminal',
      sessionId: '',
      status: 'standby',
      recoveryIssue: 'remote_worker_unavailable',
    })
    expect(invoked).toEqual(['mount.list'])
  })

  it('keeps legacy binding-absent local recovery and logs the local decision', async () => {
    vi.mocked(logAgentLaunchInfo).mockClear()
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        expect(request.id).toBe('pty.spawn')
        return {
          ok: true,
          value: { sessionId: 'legacy-local-session', profileId: null, runtimeKind: 'posix' },
        }
      }),
    } as ControlSurface

    try {
      const prepared = await prepareTerminalNode({
        controlSurface,
        ctx,
        ptyRuntime: { write: vi.fn() } as never,
        store: { readNodeScrollback: vi.fn(async () => null) } as never,
        workspace: createWorkspace(null),
        node: createNode({
          executionDirectory: '/local/repo',
          expectedDirectory: '/local/repo',
        }),
        space: null,
      })

      expect(prepared.sessionId).toBe('legacy-local-session')
      expect(prepared.workerBinding).toEqual({ endpointId: 'local', mountId: null })
      expect(logAgentLaunchInfo).toHaveBeenCalledWith(
        'session-recovery-selected-local-worker',
        expect.any(String),
        expect.objectContaining({ reason: 'legacy_node_without_space' }),
      )
    } finally {
      vi.mocked(logAgentLaunchInfo).mockClear()
    }
  })

  it('keeps the Space-derived remote route for legacy nodes without a binding', async () => {
    const controlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        if (request.id === 'mount.list') {
          return {
            ok: true,
            value: {
              projectId: 'workspace-1',
              mounts: [mount('mount-remote', 'endpoint-remote', '/remote/repo')],
            },
          }
        }
        expect(request.id).toBe('pty.spawnInMount')
        return {
          ok: true,
          value: { sessionId: 'legacy-remote-session', profileId: null, runtimeKind: 'posix' },
        }
      }),
    } as ControlSurface
    const space = createSpace({ targetMountId: 'mount-remote', directoryPath: '/remote/repo' })

    const prepared = await prepareTerminalNode({
      controlSurface,
      ctx,
      ptyRuntime: { write: vi.fn() } as never,
      store: { readNodeScrollback: vi.fn(async () => null) } as never,
      workspace: createWorkspace(space),
      node: createNode({ workerBinding: null }),
      space,
    })

    expect(prepared).toMatchObject({
      sessionId: 'legacy-remote-session',
      workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-remote' },
    })
  })
})
