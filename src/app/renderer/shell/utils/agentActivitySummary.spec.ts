import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type TerminalNodeData,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { summarizeAgentActivity } from './agentActivitySummary'

function agent(id: string, status: TerminalNodeData['status']): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      sessionId: `${id}-session`,
      title: id,
      width: 320,
      height: 240,
      kind: 'agent',
      status,
      startedAt: '2026-10-17T10:00:00.000Z',
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      executionDirectory: null,
      expectedDirectory: null,
      agent: null,
      task: null,
      note: null,
      role: null,
      image: null,
      document: null,
      website: null,
    },
    type: 'default',
  } as Node<TerminalNodeData>
}

function workspace(id: string, nodes: Node<TerminalNodeData>[]): WorkspaceState {
  return {
    id,
    name: id,
    path: `/tmp/${id}`,
    worktreesRoot: '',
    nodes,
    viewport: DEFAULT_WORKSPACE_VIEWPORT,
    isMinimapVisible: DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
    spaces: [],
    activeSpaceId: null,
    spaceArchiveRecords: [],
  }
}

describe('summarizeAgentActivity', () => {
  it('lists waiting agents across projects in project order and counts working ones', () => {
    const summary = summarizeAgentActivity([
      workspace('alpha', [agent('a-1', 'running'), agent('a-2', 'waiting')]),
      workspace('beta', [
        agent('b-1', 'waiting'),
        agent('b-2', 'standby'),
        agent('b-3', 'running'),
      ]),
    ])
    expect(summary.waiting).toEqual([
      {
        workspaceId: 'alpha',
        projectName: 'alpha',
        projectIconId: null,
        nodeId: 'a-2',
        title: 'a-2',
        spaceName: null,
      },
      {
        workspaceId: 'beta',
        projectName: 'beta',
        projectIconId: null,
        nodeId: 'b-1',
        title: 'b-1',
        spaceName: null,
      },
    ])
    expect(summary.workingCount).toBe(2)
  })

  it('names the Space a waiting agent sits in', () => {
    const project = workspace('alpha', [agent('a-1', 'waiting')])
    project.spaces = [
      {
        id: 'space-review',
        name: 'review-431',
        directoryPath: '/tmp/alpha',
        targetMountId: null,
        labelColor: null,
        nodeIds: ['a-1'],
        rect: null,
      },
    ]
    expect(summarizeAgentActivity([project]).waiting[0]?.spaceName).toBe('review-431')
  })

  it('is empty when no agent is waiting or working', () => {
    expect(summarizeAgentActivity([workspace('alpha', [agent('a-1', 'standby')])])).toEqual({
      waiting: [],
      workingCount: 0,
    })
  })
})
