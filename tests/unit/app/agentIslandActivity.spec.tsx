import React, { useRef } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { AgentIsland } from '../../../src/app/renderer/shell/components/AgentIsland'
import { summarizeAgentActivity } from '../../../src/app/renderer/shell/utils/agentActivitySummary'
import {
  createAgentAttentionRouter,
  AGENT_ATTENTION_REWORK_DEBOUNCE_MS,
} from '../../../src/app/renderer/shell/utils/agentAttentionRouter'
import {
  useAgentAttentionStore,
  useAgentsNeedingYou,
} from '../../../src/app/renderer/shell/store/useAgentAttentionStore'
import type { AgentStandbyNotification } from '../../../src/app/renderer/shell/utils/agentStandbyNotification'
import type { WorkspaceState } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createTerminalAgentWorkspace } from '../contexts/terminalAgentExit.testSupport'

function Harness({ workspace }: { workspace: WorkspaceState }) {
  const notifications = useAgentAttentionStore(state => state.notifications)
  const needsYou = useAgentsNeedingYou()
  const pillRef = useRef<HTMLButtonElement | null>(null)
  return (
    <>
      <button ref={pillRef}>Agents</button>
      <AgentIsland
        notifications={notifications}
        summary={summarizeAgentActivity([workspace], needsYou)}
        pillRef={pillRef}
        isListOpen={false}
        contextVisibility={{
          showTask: false,
          showSpace: false,
          showBranch: false,
          showPullRequest: false,
        }}
        onActivate={() => {}}
        onDismiss={() => {}}
      />
    </>
  )
}

afterEach(async () => {
  cleanup()
  useAgentAttentionStore.setState({ notifications: [] })
  vi.useRealTimers()
  await applyUiLanguage('en')
})

it.each([
  ['en', 'Finished', 'Working'],
  ['zh-CN', '已完成', '工作中'],
] as const)(
  'shows live work during the existing dismissal debounce in %s',
  async (language, finished, working) => {
    await applyUiLanguage(language)
    vi.useFakeTimers()
    const workspace = createTerminalAgentWorkspace()
    const node = workspace.nodes[0]
    node.data.agentRuntimeObservation = { ...node.data.agentRuntimeObservation!, status: 'standby' }
    const item: AgentStandbyNotification = {
      kind: 'agent-standby',
      id: 'completion',
      sessionId: 'pty-1',
      nodeId: node.id,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      workspacePath: workspace.path,
      title: 'Review changes',
      taskId: null,
      taskTitle: null,
      spaceId: null,
      spaceName: null,
      spaceDirectoryPath: null,
      executionDirectory: workspace.path,
      gitContext: null,
      pullRequest: null,
      createdAt: Date.now(),
    }
    const router = createAgentAttentionRouter<AgentStandbyNotification>({
      channels: () => ({ inApp: true, system: false, sound: false }),
      emit: effect => {
        if (effect.kind === 'show-card') {
          useAgentAttentionStore.getState().setNotifications([effect.item])
        }
        if (effect.kind === 'clear-card') {
          useAgentAttentionStore
            .getState()
            .setNotifications(previous =>
              previous.filter(entry => entry.sessionId !== effect.sessionId),
            )
        }
      },
    })
    try {
      router.needsYou(item)
      const { rerender } = render(<Harness workspace={workspace} />)
      expect(screen.getByText(finished)).toBeVisible()
      const running = {
        ...workspace,
        nodes: [
          {
            ...node,
            data: {
              ...node.data,
              agentRuntimeObservation: {
                ...node.data.agentRuntimeObservation!,
                status: 'running' as const,
              },
            },
          },
        ],
      }
      act(() => router.working(item.sessionId))
      rerender(<Harness workspace={running} />)
      expect(screen.getByText(working)).toBeVisible()
      expect(screen.queryByText(finished)).toBeNull()
      act(() => vi.advanceTimersByTime(AGENT_ATTENTION_REWORK_DEBOUNCE_MS - 1))
      expect(screen.getByText(working)).toBeVisible()
      expect(useAgentAttentionStore.getState().notifications).toHaveLength(1)
      act(() => vi.advanceTimersByTime(1))
      expect(screen.queryByTestId('app-notifications')).toBeNull()
      expect(useAgentAttentionStore.getState().notifications).toEqual([])
    } finally {
      router.dispose()
    }
  },
)
