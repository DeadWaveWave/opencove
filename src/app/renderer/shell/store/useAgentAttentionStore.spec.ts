import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { agentAttentionKey } from '../utils/agentActivitySummary'
import type { AgentStandbyNotification } from '../utils/agentStandbyNotification'
import { useAgentAttentionStore, useAgentsNeedingYou } from './useAgentAttentionStore'

const initialState = useAgentAttentionStore.getInitialState()

function notification(
  id: string,
  workspaceId: string,
  nodeId: string,
  createdAt: number,
): AgentStandbyNotification {
  return {
    kind: 'agent-standby',
    id,
    sessionId: id,
    workspaceId,
    workspaceName: workspaceId,
    workspacePath: `/tmp/${workspaceId}`,
    nodeId,
    title: `codex · ${nodeId}`,
    taskId: null,
    taskTitle: null,
    spaceId: null,
    spaceName: null,
    spaceDirectoryPath: null,
    executionDirectory: `/tmp/${workspaceId}`,
    gitContext: null,
    pullRequest: null,
    createdAt,
  }
}

const ids = () => useAgentAttentionStore.getState().notifications.map(item => item.id)

afterEach(() => {
  useAgentAttentionStore.setState(initialState, true)
})

describe('useAgentAttentionStore', () => {
  it('keeps its state when an update changes nothing', () => {
    const before = useAgentAttentionStore.getState()
    before.setNotifications(previous => previous)
    before.dismiss('missing')
    before.acknowledgeNode('alpha', 'missing')
    expect(useAgentAttentionStore.getState()).toBe(before)
  })

  it('answers one Agent on ✕', () => {
    useAgentAttentionStore.setState({
      notifications: [
        notification('s-2', 'alpha', 'n-2', 2),
        notification('s-1', 'alpha', 'n-1', 1),
      ],
    })
    useAgentAttentionStore.getState().dismiss('s-2')
    expect(ids()).toEqual(['s-1'])
  })

  it('answers every notice of the Agent you went to, and only that Agent', () => {
    useAgentAttentionStore.setState({
      notifications: [
        notification('s-3', 'alpha', 'n-1', 3),
        notification('s-2', 'beta', 'n-1', 2),
        notification('s-1', 'alpha', 'n-1', 1),
      ],
    })
    useAgentAttentionStore.getState().acknowledgeNode('alpha', 'n-1')
    expect(ids()).toEqual(['s-2'])
  })

  it('tells since when each unanswered Agent has waited, the first notice winning', () => {
    useAgentAttentionStore.setState({
      notifications: [
        notification('s-3', 'alpha', 'n-1', 30),
        notification('s-2', 'beta', 'n-2', 20),
        notification('s-1', 'alpha', 'n-1', 10),
      ],
    })
    const { result } = renderHook(() => useAgentsNeedingYou())
    expect([...result.current]).toEqual([
      [agentAttentionKey('alpha', 'n-1'), 10],
      [agentAttentionKey('beta', 'n-2'), 20],
    ])

    const first = result.current
    act(() => useAgentAttentionStore.getState().dismiss('s-2'))
    expect(result.current).not.toBe(first)
    expect([...result.current]).toEqual([[agentAttentionKey('alpha', 'n-1'), 10]])
  })
})
