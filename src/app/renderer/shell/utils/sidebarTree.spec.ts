import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type TerminalNodeData,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { Node } from '@xyflow/react'
import { buildSidebarProjectTree, SIDEBAR_UNASSIGNED_SPACE_GROUP_ID } from './sidebarTree'

function createAgentNode(
  id: string,
  startedAt: string,
  sidebarSortOrder?: number,
): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    data: {
      sessionId: `${id}-session`,
      title: id,
      width: 320,
      height: 240,
      kind: 'agent',
      status: 'running',
      startedAt,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: null,
      expectedDirectory: null,
      sidebarSortOrder,
      agent: {
        provider: 'codex',
        prompt: 'ship it',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        launchMode: 'new',
        resumeSessionId: null,
        executionDirectory: '/tmp/project-a',
        expectedDirectory: '/tmp/project-a',
        directoryMode: 'workspace',
        customDirectory: null,
        shouldCreateDirectory: false,
        taskId: null,
      },
      task: null,
      note: null,
      role: null,
      image: null,
      document: null,
      website: null,
    },
    type: 'default',
    measured: { width: 320, height: 240 },
    selected: false,
    dragging: false,
    deletable: true,
  }
}

function createWorkspace(): WorkspaceState {
  return {
    id: 'project-a',
    name: 'Project A',
    path: '/tmp/project-a',
    worktreesRoot: '',
    nodes: [
      createAgentNode('agent-root', '2026-03-29T10:00:00.000Z'),
      createAgentNode('agent-api', '2026-03-29T10:02:00.000Z'),
      createAgentNode('agent-child', '2026-03-29T10:03:00.000Z'),
    ],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [
      {
        id: 'space-web',
        name: 'Web',
        directoryPath: '/tmp/project-a',
        targetMountId: null,
        labelColor: 'blue',
        nodeIds: ['agent-api'],
        rect: null,
        sortOrder: 2,
      },
      {
        id: 'space-api',
        name: 'API',
        directoryPath: '/tmp/project-a/api',
        targetMountId: null,
        labelColor: 'purple',
        nodeIds: [],
        rect: null,
        sortOrder: 1,
      },
      {
        id: 'space-api-child',
        name: 'API Child',
        directoryPath: '/tmp/project-a/api/child',
        targetMountId: null,
        parentSpaceId: 'space-api',
        labelColor: 'green',
        nodeIds: ['agent-child'],
        rect: null,
      },
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('buildSidebarProjectTree', () => {
  it('groups agents by top-level space and keeps unassigned agents in project root', () => {
    const tree = buildSidebarProjectTree(createWorkspace())

    expect(tree.agentCount).toBe(3)
    expect(tree.workingAgentCount).toBe(3)
    expect(tree.spaceGroups.map(group => group.id)).toEqual(['space-api', 'space-web'])
    expect(tree.spaceGroups[0].agents.map(agent => agent.node.id)).toEqual(['agent-child'])
    expect(tree.spaceGroups[1].agents.map(agent => agent.node.id)).toEqual(['agent-api'])
    expect(tree.projectRootGroup?.id).toBe(SIDEBAR_UNASSIGNED_SPACE_GROUP_ID)
    expect(tree.projectRootGroup?.agents.map(agent => agent.node.id)).toEqual(['agent-root'])
  })

  it('uses explicit sidebar agent order before startedAt fallback', () => {
    const workspace = createWorkspace()
    workspace.nodes = [
      createAgentNode('agent-old', '2026-03-29T10:00:00.000Z', 0),
      createAgentNode('agent-new', '2026-03-29T10:03:00.000Z', 1),
    ]
    workspace.spaces = []

    const tree = buildSidebarProjectTree(workspace)

    expect(tree.projectRootGroup?.agents.map(agent => agent.node.id)).toEqual([
      'agent-old',
      'agent-new',
    ])
  })
})
