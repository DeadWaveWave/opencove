import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { DEFAULT_AGENT_ENV_BY_PROVIDER } from '../../../src/contexts/settings/domain/agentEnv'
import { useWorkspaceCanvasAgentNodeLifecycle } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useAgentNodeLifecycle'
import { readWorkspaceDocument } from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocumentCommands'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'

// A relaunch repairs the mount of the Space that owns the agent after `mount.list` answers. The
// repair is written through the document commands of the workspace the relaunch started in, as a
// recipe over the Spaces that workspace holds then, and flushes once (#702).

const NODE_ID = 'agent-1'

function agentNode(): Node<TerminalNodeData> {
  return {
    id: NODE_ID,
    position: { x: 0, y: 0 },
    data: {
      kind: 'agent',
      sessionId: '',
      title: 'Agent',
      width: 600,
      height: 400,
      status: 'standby',
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: {
        provider: 'codex',
        prompt: 'fixture',
        model: null,
        effectiveModel: null,
        launchMode: 'new',
        resumeSessionId: null,
        resumeSessionIdVerified: false,
        executionDirectory: '/repo',
        expectedDirectory: '/repo',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
      note: null,
      image: null,
    },
  }
}

function owningSpace(
  id: string,
  overrides: Partial<WorkspaceSpaceState> = {},
): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/repo',
    targetMountId: 'mount-stale',
    labelColor: null,
    nodeIds: [NODE_ID],
    rect: null,
    ...overrides,
  }
}

function mountsOf(workspaceId: string) {
  return {
    mounts: [
      {
        mountId: `mount-of-${workspaceId}`,
        projectId: workspaceId,
        name: 'Primary',
        sortOrder: 0,
        endpointId: 'local',
        targetId: 'target-1',
        rootPath: '/repo',
        rootUri: 'file:///repo',
        createdAt: '',
        updatedAt: '',
      },
    ],
  }
}

// The store's own workspace object: it is replaced by a write and by nothing else.
function workspaceOf(workspaceId: string) {
  return useAppStore.getState().workspaces.find(workspace => workspace.id === workspaceId)
}

function spacesOf(workspaceId: string): WorkspaceSpaceState[] {
  return readWorkspaceDocument(workspaceId)?.spaces ?? []
}

describe('agent relaunch mount repair', () => {
  let shown: string
  let nodes: { current: Node<TerminalNodeData>[] }
  let answers: Array<{ workspaceId: string; answer: () => void }>
  let harness: ReturnType<typeof createCanvasDocumentHarness>

  beforeEach(() => {
    shown = 'workspace-a'
    nodes = { current: [agentNode()] }
    answers = []
    harness = createCanvasDocumentHarness({
      workspaceId: 'workspace-a',
      spaces: [owningSpace('space-a')],
    })
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        {
          ...state.workspaces[0],
          id: 'workspace-b',
          name: 'workspace-b',
          spaces: [owningSpace('space-b')],
        },
      ],
    }))
    window.opencoveApi = {
      controlSurface: {
        invoke: vi.fn(
          (request: { id: string; payload?: { projectId?: string } }) =>
            new Promise(resolve => {
              if (request.id === 'mount.list') {
                const workspaceId = request.payload?.projectId ?? ''
                answers.push({ workspaceId, answer: () => resolve(mountsOf(workspaceId)) })
                return
              }
              resolve({
                sessionId: 'session-1',
                profileId: null,
                runtimeKind: 'posix',
                effectiveModel: null,
                executionContext: {
                  workingDirectory: '/repo',
                  endpoint: { endpointId: 'local' },
                  mountId: 'mount-of-launch',
                },
              })
            }),
        ),
      },
      agent: { launch: vi.fn() },
      pty: { kill: vi.fn() },
    } as unknown as typeof window.opencoveApi
  })

  function renderLifecycle() {
    return renderInCanvasDocument(
      () =>
        useWorkspaceCanvasAgentNodeLifecycle({
          workspaceId: shown,
          workspacePath: '/repo',
          nodesRef: nodes,
          // The real getter reads the store; this one reads the workspace that is shown.
          spacesRef: {
            get current() {
              return spacesOf(shown)
            },
          },
          setNodes: updater => {
            nodes.current = updater(nodes.current)
          },
          bumpAgentLaunchToken: () => 1,
          isAgentLaunchTokenCurrent: () => true,
          agentFullAccess: true,
          codexReuseRunningAppServer: false,
          defaultTerminalProfileId: null,
          terminalFontSize: 13,
          terminalDisplayMetrics: { fontSize: 13 },
          agentEnvByProvider: DEFAULT_AGENT_ENV_BY_PROVIDER,
        }),
      { workspaceId: () => shown },
    )
  }

  async function answerMountList(): Promise<void> {
    await vi.waitFor(() => expect(answers.length).toBeGreaterThan(0))
    answers.shift()?.answer()
  }

  it('writes the Spaces of the workspace it started in after a switch during mount.list', async () => {
    const view = renderLifecycle()
    const workspaceBBefore = workspaceOf('workspace-b')
    const launchInA = view.result.current.launchAgentInNode

    let launched!: Promise<void>
    act(() => {
      launched = launchInA(NODE_ID, 'new')
    })
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    expect(answers[0].workspaceId).toBe('workspace-a')
    act(() => {
      shown = 'workspace-b'
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
      view.rerender()
    })
    harness.notifications.mockClear()
    harness.flush.mockClear()
    await answerMountList()
    await act(async () => {
      await launched
    })

    expect(spacesOf('workspace-a').map(item => [item.id, item.targetMountId])).toEqual([
      ['space-a', 'mount-of-workspace-a'],
    ])
    expect(workspaceOf('workspace-b')).toBe(workspaceBBefore)
    expect(harness.flush).toHaveBeenCalledTimes(1)
  })

  it('writes the Spaces of the workspace that is shown when the relaunch starts there', async () => {
    const view = renderLifecycle()
    act(() => {
      shown = 'workspace-b'
      useAppStore.setState({ activeWorkspaceId: 'workspace-b' })
      view.rerender()
    })
    const workspaceABefore = workspaceOf('workspace-a')

    let launched!: Promise<void>
    act(() => {
      launched = view.result.current.launchAgentInNode(NODE_ID, 'new')
    })
    await answerMountList()
    await act(async () => {
      await launched
    })

    expect(spacesOf('workspace-b').map(item => [item.id, item.targetMountId])).toEqual([
      ['space-b', 'mount-of-workspace-b'],
    ])
    expect(workspaceOf('workspace-a')).toBe(workspaceABefore)
  })

  it('keeps a Space that changed in the store while mount.list was pending', async () => {
    const view = renderLifecycle()
    let launched!: Promise<void>
    act(() => {
      launched = view.result.current.launchAgentInNode(NODE_ID, 'new')
    })
    await vi.waitFor(() => expect(answers).toHaveLength(1))
    act(() => {
      useAppStore.setState(state => ({
        workspaces: state.workspaces.map(workspace =>
          workspace.id === 'workspace-a'
            ? {
                ...workspace,
                spaces: [
                  { ...workspace.spaces[0], name: 'Renamed' },
                  owningSpace('space-late', { nodeIds: [] }),
                ],
              }
            : workspace,
        ),
      }))
    })
    await answerMountList()
    await act(async () => {
      await launched
    })

    expect(spacesOf('workspace-a').map(item => [item.id, item.name, item.targetMountId])).toEqual([
      ['space-a', 'Renamed', 'mount-of-workspace-a'],
      ['space-late', 'space-late', 'mount-stale'],
    ])
  })
})
