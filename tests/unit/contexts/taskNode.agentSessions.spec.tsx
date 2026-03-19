import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TaskNode } from '../../../src/contexts/workspace/presentation/renderer/components/TaskNode'
import type { TaskAgentSessionRecord } from '../../../src/contexts/workspace/presentation/renderer/types'

vi.mock('@xyflow/react', () => {
  return {
    Handle: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
  }
})

describe('TaskNode agent sessions', () => {
  it('renders sessions and supports resume + remove', () => {
    const sessions: TaskAgentSessionRecord[] = [
      {
        id: 'session-1',
        provider: 'codex',
        resumeSessionId: 'resume-1',
        resumeSessionIdVerified: true,
        prompt: 'Implement worktree binding',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        boundDirectory: '/repo',
        lastDirectory: '/repo',
        createdAt: '2026-02-08T15:00:00.000Z',
        lastRunAt: '2026-02-08T15:00:00.000Z',
        endedAt: '2026-02-08T15:10:00.000Z',
        exitCode: 0,
        status: 'exited',
      },
    ]

    const onResumeSession = vi.fn()
    const onRemoveSession = vi.fn()

    render(
      <TaskNode
        title="Task"
        requirement="Do it"
        status="todo"
        priority="medium"
        tags={[]}
        createdAt={null}
        updatedAt={null}
        linkedAgentNode={{
          nodeId: 'agent-1',
          title: 'codex · gpt-5.2-codex',
          provider: 'codex',
          status: 'running',
          startedAt: '2026-02-08T15:20:00.000Z',
        }}
        agentSessions={sessions}
        currentDirectory="/repo"
        position={{ x: 0, y: 0 }}
        width={420}
        height={260}
        onClose={() => undefined}
        onOpenEditor={() => undefined}
        onQuickTitleSave={() => undefined}
        onQuickRequirementSave={() => undefined}
        onRunAgent={() => undefined}
        onResize={() => undefined}
        onStatusChange={() => undefined}
        onResumeAgentSession={onResumeSession}
        onRemoveAgentSessionRecord={onRemoveSession}
      />,
    )

    expect(screen.getByTestId('task-node-agent-sessions')).toBeVisible()
    expect(screen.getByTestId('task-node-agent-session-linked-agent-1')).toBeVisible()
    expect(screen.getByTestId('task-node-agent-session-record-session-1')).toBeVisible()

    fireEvent.contextMenu(screen.getByTestId('task-node-agent-session-record-session-1'))
    fireEvent.click(screen.getByTestId('task-node-agent-session-menu-resume-session-1'))
    expect(screen.getByTestId('task-node-agent-session-resume-confirm')).toBeVisible()
    fireEvent.click(screen.getByTestId('task-node-agent-session-resume-confirm-resume-session-1'))
    expect(onResumeSession).toHaveBeenCalledWith('session-1')

    fireEvent.contextMenu(screen.getByTestId('task-node-agent-session-record-session-1'))
    fireEvent.click(screen.getByTestId('task-node-agent-session-menu-remove-session-1'))
    expect(onRemoveSession).toHaveBeenCalledWith('session-1')
  })

  it('hides resume action for unverified codex records', () => {
    const sessions: TaskAgentSessionRecord[] = [
      {
        id: 'session-legacy',
        provider: 'codex',
        resumeSessionId: 'legacy-resume-id',
        prompt: 'Implement worktree binding',
        model: 'gpt-5.2-codex',
        effectiveModel: 'gpt-5.2-codex',
        boundDirectory: '/repo',
        lastDirectory: '/repo',
        createdAt: '2026-02-08T15:00:00.000Z',
        lastRunAt: '2026-02-08T15:00:00.000Z',
        endedAt: '2026-02-08T15:10:00.000Z',
        exitCode: 0,
        status: 'exited',
      },
    ]

    render(
      <TaskNode
        title="Task"
        requirement="Do it"
        status="todo"
        priority="medium"
        tags={[]}
        createdAt={null}
        updatedAt={null}
        linkedAgentNode={null}
        agentSessions={sessions}
        currentDirectory="/repo"
        position={{ x: 0, y: 0 }}
        width={420}
        height={260}
        onClose={() => undefined}
        onOpenEditor={() => undefined}
        onQuickTitleSave={() => undefined}
        onQuickRequirementSave={() => undefined}
        onRunAgent={() => undefined}
        onResize={() => undefined}
        onStatusChange={() => undefined}
        onResumeAgentSession={() => undefined}
        onRemoveAgentSessionRecord={() => undefined}
      />,
    )

    fireEvent.contextMenu(screen.getByTestId('task-node-agent-session-record-session-legacy'))
    expect(screen.queryByTestId('task-node-agent-session-menu-resume-session-legacy')).toBeNull()
    expect(screen.getByTestId('task-node-agent-session-menu-remove-session-legacy')).toBeVisible()
  })
})
