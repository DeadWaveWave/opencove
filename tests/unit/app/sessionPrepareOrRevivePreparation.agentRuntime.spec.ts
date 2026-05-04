import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { prepareAgentNode } from '../../../src/app/main/controlSurface/handlers/sessionPrepareOrRevivePreparation'
import type { ControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfaceContext } from '../../../src/app/main/controlSurface/types'
import type {
  NormalizedPersistedNode,
  NormalizedPersistedSpace,
  NormalizedPersistedWorkspace,
} from '../../../src/platform/persistence/sqlite/normalize'
import type { PreparedRuntimeAgentResult } from '../../../src/shared/contracts/dto'

const ctx: ControlSurfaceContext = {
  now: () => new Date('2026-05-01T00:00:00.000Z'),
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

function createAgentNode(
  overrides: Partial<NormalizedPersistedNode> = {},
): NormalizedPersistedNode {
  return {
    id: 'agent-1',
    sessionId: 'dead-session',
    title: 'codex',
    position: { x: 0, y: 0 },
    width: 520,
    height: 360,
    kind: 'agent',
    profileId: 'wsl:Ubuntu',
    runtimeKind: 'wsl',
    terminalGeometry: { cols: 80, rows: 24 },
    terminalProviderHint: null,
    labelColorOverride: null,
    status: 'running',
    startedAt: '2026-05-01T00:00:00.000Z',
    endedAt: null,
    exitCode: null,
    lastError: null,
    executionDirectory: 'C:\\repo',
    expectedDirectory: 'C:\\repo',
    agent: null,
    task: null,
    scrollback: null,
    ...overrides,
  }
}

function createWorkspace(space: NormalizedPersistedSpace): NormalizedPersistedWorkspace {
  return {
    id: 'workspace-1',
    name: 'repo',
    path: 'C:\\repo',
    worktreesRoot: '',
    pullRequestBaseBranchOptions: [],
    environmentVariables: {},
    spaceArchiveRecords: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    isMinimapVisible: true,
    spaces: [space],
    activeSpaceId: space.id,
    nodes: [],
  }
}

function createAgentRecord(): PreparedRuntimeAgentResult {
  return {
    provider: 'codex',
    prompt: '',
    model: 'gpt-5.2-codex',
    effectiveModel: 'gpt-5.2-codex',
    launchMode: 'resume',
    resumeSessionId: 'resume-1',
    resumeSessionIdVerified: true,
    executionDirectory: 'C:\\repo',
    expectedDirectory: 'C:\\repo',
    directoryMode: 'workspace',
    customDirectory: null,
    shouldCreateDirectory: false,
    taskId: null,
  }
}

describe('session prepare/revive agent runtime metadata', () => {
  it('uses the mounted launch runtime metadata instead of the stale persisted default profile', async () => {
    const controlSurface: ControlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        expect(request.id).toBe('session.launchAgentInMount')
        return {
          ok: true,
          value: {
            sessionId: 'mounted-session-1',
            provider: 'codex' as const,
            startedAt: '2026-05-01T00:00:00.000Z',
            executionContext: {
              projectId: 'workspace-1',
              spaceId: 'space-1',
              mountId: 'mount-1',
              targetId: 'target-1',
              endpoint: {
                endpointId: 'local',
                kind: 'local' as const,
              },
              target: {
                scheme: 'file' as const,
                rootPath: 'C:\\repo',
                rootUri: 'file:///C:/repo',
              },
              scope: {
                rootPath: 'C:\\repo',
                rootUri: 'file:///C:/repo',
              },
              workingDirectory: 'C:\\repo',
            },
            profileId: null,
            runtimeKind: 'windows' as const,
            resumeSessionId: 'resume-1',
            effectiveModel: 'gpt-5.2-codex',
            command: 'cmd.exe',
            args: ['/d', '/c', 'codex.cmd'],
          },
        }
      }),
    } as ControlSurface

    const space: NormalizedPersistedSpace = {
      id: 'space-1',
      name: 'Main',
      directoryPath: 'C:\\repo',
      targetMountId: 'mount-1',
      labelColor: null,
      nodeIds: ['agent-1'],
      rect: null,
    }

    const prepared = await prepareAgentNode({
      controlSurface,
      ctx,
      store: {
        readNodeScrollback: vi.fn(async () => null),
      } as never,
      workspace: createWorkspace(space),
      node: createAgentNode(),
      space,
      agent: createAgentRecord(),
      settings: {
        ...DEFAULT_AGENT_SETTINGS,
        defaultTerminalProfileId: 'wsl:Ubuntu',
      },
    })

    expect(prepared.recoveryState).toBe('revived')
    expect(prepared.profileId).toBeNull()
    expect(prepared.runtimeKind).toBe('windows')
  })

  it('revives a verified non-stopped agent window without rebinding to provider metadata', async () => {
    const controlSurface: ControlSurface = {
      invoke: vi.fn(async (_ctx, request) => {
        expect(request.id).toBe('session.launchAgentInMount')
        expect((request.payload as { resumeSessionId?: string }).resumeSessionId).toBe('resume-1')
        return {
          ok: true,
          value: {
            sessionId: 'mounted-session-1',
            provider: 'claude-code' as const,
            startedAt: '2026-05-01T00:00:00.000Z',
            executionContext: {
              projectId: 'workspace-1',
              spaceId: 'space-1',
              mountId: 'mount-1',
              targetId: 'target-1',
              endpoint: { endpointId: 'local', kind: 'local' as const },
              target: {
                scheme: 'file' as const,
                rootPath: 'C:\\repo',
                rootUri: 'file:///C:/repo',
              },
              scope: {
                rootPath: 'C:\\repo',
                rootUri: 'file:///C:/repo',
              },
              workingDirectory: 'C:\\repo',
            },
            profileId: null,
            runtimeKind: 'windows' as const,
            resumeSessionId: 'wrong-provider-session',
            effectiveModel: 'sonnet',
            command: 'cmd.exe',
            args: ['/d', '/c', 'claude.cmd', '--resume', 'resume-1'],
          },
        }
      }),
    } as ControlSurface
    const space: NormalizedPersistedSpace = {
      id: 'space-1',
      name: 'Main',
      directoryPath: 'C:\\repo',
      targetMountId: 'mount-1',
      labelColor: null,
      nodeIds: ['agent-1'],
      rect: null,
    }

    const prepared = await prepareAgentNode({
      controlSurface,
      ctx,
      store: { readNodeScrollback: vi.fn(async () => null) } as never,
      workspace: createWorkspace(space),
      node: createAgentNode({ status: 'exited', exitCode: 0 }),
      space,
      agent: { ...createAgentRecord(), provider: 'claude-code', effectiveModel: 'sonnet' },
      settings: DEFAULT_AGENT_SETTINGS,
    })

    expect(prepared.recoveryState).toBe('revived')
    expect(prepared.status).toBe('standby')
    expect(prepared.agent?.resumeSessionId).toBe('resume-1')
    expect(prepared.agent?.resumeSessionIdVerified).toBe(true)
  })
})
