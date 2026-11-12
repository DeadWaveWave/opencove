import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import {
  DEFAULT_WORKSPACE_MINIMAP_VISIBLE,
  DEFAULT_WORKSPACE_VIEWPORT,
  type TerminalNodeData,
  type WorkspaceState,
} from '@contexts/workspace/presentation/renderer/types'
import { summarizeAgentActivity } from './agentActivitySummary'
import { agentAttentionKey } from './sidebarAgents'

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
  it('lists waiting and working agents across projects in project order', () => {
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
        provider: null,
      },
      {
        workspaceId: 'beta',
        projectName: 'beta',
        projectIconId: null,
        nodeId: 'b-1',
        title: 'b-1',
        spaceName: null,
        provider: null,
      },
    ])
    expect(summary.working.map(item => [item.workspaceId, item.nodeId])).toEqual([
      ['alpha', 'a-1'],
      ['beta', 'b-3'],
    ])
  })

  it("carries the Agent's provider for its mark", () => {
    const codex = agent('a-1', 'waiting')
    codex.data.agent = { provider: 'codex' } as TerminalNodeData['agent']
    expect(summarizeAgentActivity([workspace('alpha', [codex])]).waiting[0]?.provider).toBe('codex')
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

  it('counts an Agent you have not answered since its turn ended as waiting for you', () => {
    const summary = summarizeAgentActivity(
      [workspace('alpha', [agent('a-1', 'standby'), agent('a-2', 'standby')])],
      new Map([[agentAttentionKey('alpha', 'a-2'), 1_000]]),
    )
    expect(summary.waiting.map(item => [item.nodeId, item.needsYouSinceMs])).toEqual([
      ['a-2', 1_000],
    ])
    expect(summary.working).toEqual([])
  })

  it('keeps an Agent that works again, exited, or never ended a turn, out of waiting', () => {
    const needsYou = new Map([
      [agentAttentionKey('alpha', 'a-1'), 1_000],
      [agentAttentionKey('beta', 'a-2'), 1_000],
      [agentAttentionKey('alpha', 'a-3'), 1_000],
    ])
    const summary = summarizeAgentActivity(
      [
        workspace('alpha', [
          agent('a-1', 'running'),
          agent('a-2', 'standby'),
          agent('a-3', 'exited'),
        ]),
      ],
      needsYou,
    )
    expect(summary.waiting).toEqual([])
    expect(summary.working.map(item => item.nodeId)).toEqual(['a-1'])
  })

  it('is empty when no agent is waiting or working', () => {
    expect(summarizeAgentActivity([workspace('alpha', [agent('a-1', 'standby')])])).toEqual({
      waiting: [],
      working: [],
    })
  })
})
