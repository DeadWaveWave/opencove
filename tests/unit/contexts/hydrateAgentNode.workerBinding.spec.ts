import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'
import { hydrateAgentNode } from '../../../src/contexts/agent/presentation/renderer/hydrateAgentNode'
import { prepareWorkspaceRuntimeNodes } from '../../../src/app/renderer/shell/hooks/useHydrateAppState.helpers'
import type {
  PersistedWorkspaceState,
  TerminalNodeData,
} from '../../../src/contexts/workspace/presentation/renderer/types'

const launch = vi.fn()
const spawn = vi.fn()

function createAgentNode() {
  return {
    id: 'remote-agent',
    type: 'terminalNode',
    position: { x: 0, y: 0 },
    data: {
      sessionId: '',
      title: 'Remote Agent',
      width: 520,
      height: 360,
      kind: 'agent',
      status: 'running',
      startedAt: '2026-08-15T00:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      recoveryIssue: null,
      scrollback: null,
      executionDirectory: '/remote/repo',
      expectedDirectory: '/remote/repo',
      workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-remote' },
      agent: {
        provider: 'claude-code',
        prompt: '',
        model: null,
        effectiveModel: null,
        launchMode: 'resume',
        resumeSessionId: 'resume-remote',
        resumeSessionIdVerified: true,
        executionDirectory: '/remote/repo',
        expectedDirectory: '/remote/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
      note: null,
      image: null,
      document: null,
      website: null,
    } as TerminalNodeData,
  }
}

beforeEach(() => {
  launch.mockReset()
  spawn.mockReset()
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      agent: {
        launch,
        resolveResumeSessionId: vi.fn(async () => ({ resumeSessionId: null })),
      },
      pty: {
        spawn,
        snapshot: vi.fn(async () => {
          throw new Error('stale session')
        }),
      },
    },
  })
})

describe('legacy hydration remote worker guard', () => {
  it('keeps a remote Agent node intact and never launches it on the local worker', async () => {
    const node = createAgentNode()

    const hydrated = await hydrateAgentNode({
      node,
      workspacePath: '/local/repo',
      agentSettings: DEFAULT_AGENT_SETTINGS,
    })

    expect(launch).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(hydrated.data).toMatchObject({
      kind: 'agent',
      sessionId: '',
      status: 'standby',
      recoveryIssue: 'remote_worker_unavailable',
      workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-remote' },
    })
    expect(hydrated.data.agent?.resumeSessionId).toBe('resume-remote')
  })

  it('never launches a bound remote terminal through the legacy local hydrate path', async () => {
    const agentNode = createAgentNode()
    const terminal = {
      ...agentNode,
      id: 'remote-terminal',
      data: {
        ...agentNode.data,
        kind: 'terminal' as const,
        title: 'Remote Terminal',
        status: null,
        startedAt: null,
        agent: null,
      },
    }
    const workspace: PersistedWorkspaceState = {
      id: 'workspace-1',
      name: 'Workspace',
      path: '/local/repo',
      worktreesRoot: '',
      pullRequestBaseBranchOptions: [],
      environmentVariables: {},
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: true,
      spaces: [],
      activeSpaceId: null,
      spaceArchiveRecords: [],
      nodes: [
        {
          id: terminal.id,
          title: terminal.data.title,
          position: terminal.position,
          width: terminal.data.width,
          height: terminal.data.height,
          kind: 'terminal',
          status: null,
          startedAt: null,
          endedAt: null,
          exitCode: null,
          lastError: null,
          scrollback: null,
          executionDirectory: '/remote/repo',
          expectedDirectory: '/remote/repo',
          workerBinding: { endpointId: 'endpoint-remote', mountId: 'mount-remote' },
          agent: null,
          task: null,
        },
      ],
    }

    const [hydrated] = await prepareWorkspaceRuntimeNodes({
      workspace,
      agentSettings: DEFAULT_AGENT_SETTINGS,
      workerOnly: false,
    })

    expect(spawn).not.toHaveBeenCalled()
    expect(hydrated?.data).toMatchObject({
      kind: 'terminal',
      sessionId: '',
      recoveryIssue: 'remote_worker_unavailable',
    })
  })
})
