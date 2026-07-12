import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type TerminalNodeData,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { reorderWorkspaceRootSpaces, reorderWorkspaceSidebarAgents } from './sidebarReorder'

function createAgentNode(id: string, sortOrder?: number): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    width: 320,
    height: 240,
    data: {
      sessionId: `${id}-session`,
      title: `codex · ${id}`,
      width: 320,
      height: 240,
      kind: 'agent',
      status: 'running',
      startedAt: '2026-03-29T10:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: '/tmp/project-a',
      expectedDirectory: '/tmp/project-a',
      sidebarSortOrder: sortOrder,
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
    nodes: [createAgentNode('agent-a', 0), createAgentNode('agent-b', 1)],
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [
      {
        id: 'space-a',
        name: 'Space A',
        directoryPath: '/tmp/project-a/a',
        targetMountId: null,
        labelColor: 'blue',
        sortOrder: 0,
        nodeIds: ['agent-a'],
        rect: null,
      },
      {
        id: 'space-b',
        name: 'Space B',
        directoryPath: '/tmp/project-a/b',
        targetMountId: null,
        labelColor: 'green',
        sortOrder: 1,
        nodeIds: ['agent-b'],
        rect: null,
      },
    ],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('sidebarReorder', () => {
  it('updates root space sortOrder without changing node ownership', () => {
    const [workspace] = reorderWorkspaceRootSpaces(
      [createWorkspace()],
      'project-a',
      'space-a',
      'space-b',
    )

    expect(workspace?.spaces.map(space => [space.id, space.sortOrder])).toEqual([
      ['space-a', 1],
      ['space-b', 0],
    ])
    expect(workspace?.spaces.map(space => [space.id, space.nodeIds])).toEqual([
      ['space-a', ['agent-a']],
      ['space-b', ['agent-b']],
    ])
  })

  it('ignores root space reorder attempts against child spaces', () => {
    const workspace = createWorkspace()
    const source = {
      ...workspace,
      spaces: [
        ...workspace.spaces,
        {
          id: 'space-child',
          name: 'Space Child',
          directoryPath: '/tmp/project-a/a/child',
          targetMountId: null,
          parentSpaceId: 'space-a',
          labelColor: 'purple' as const,
          sortOrder: 0,
          nodeIds: [],
          rect: null,
        },
      ],
    }

    const next = reorderWorkspaceRootSpaces([source], 'project-a', 'space-a', 'space-child')

    expect(next).toEqual([source])
  })

  it('ignores root space reorder attempts across pin groups', () => {
    const workspace = createWorkspace()
    workspace.spaces = workspace.spaces.map(space =>
      space.id === 'space-a' ? { ...space, pinned: true } : space,
    )

    const next = reorderWorkspaceRootSpaces([workspace], 'project-a', 'space-a', 'space-b')

    expect(next).toEqual([workspace])
  })

  it('reorders agents only within the same sidebar group', () => {
    const source = createWorkspace()
    source.spaces = [
      { ...source.spaces[0]!, nodeIds: ['agent-a', 'agent-b'] },
      { ...source.spaces[1]!, nodeIds: [] },
    ]
    const [workspace] = reorderWorkspaceSidebarAgents([source], 'project-a', 'agent-a', 'agent-b')

    expect(workspace?.nodes.map(node => [node.id, node.data.sidebarSortOrder])).toEqual([
      ['agent-a', 1],
      ['agent-b', 0],
    ])
    expect(workspace?.spaces.map(space => [space.id, space.nodeIds])).toEqual([
      ['space-a', ['agent-a', 'agent-b']],
      ['space-b', []],
    ])
  })

  it('ignores agent reorder across different sidebar groups', () => {
    const workspace = createWorkspace()
    const next = reorderWorkspaceSidebarAgents([workspace], 'project-a', 'agent-a', 'agent-b')

    expect(next).toEqual([workspace])
  })
})
