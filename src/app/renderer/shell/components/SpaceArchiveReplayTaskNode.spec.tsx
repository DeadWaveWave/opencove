import type { ComponentProps } from 'react'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ArchivedTaskNode, type TaskNodeData } from './SpaceArchiveReplayTaskNode'

function renderArchivedTask(overrides: Partial<TaskNodeData> = {}) {
  const data: TaskNodeData = {
    kind: 'task',
    title: 'Release notes',
    requirement: 'Write the round 4 release notes.',
    status: 'ai_done',
    priority: 'high',
    tags: ['release', 'docs'],
    labelColor: null,
    linkedAgent: null,
    ...overrides,
  }
  const props = { data } as unknown as ComponentProps<typeof ArchivedTaskNode>
  render(<ArchivedTaskNode {...props} />)
  return screen.getByTestId('space-archives-window-replay-node')
}

describe('Space archive replay: a task', () => {
  it('reads as the task card, its window on its kind’s plate', () => {
    const card = renderArchivedTask()

    expect(card).toHaveAttribute('data-cove-part', 'window')
    expect(card).toHaveAttribute('data-cove-kind', 'task')
    expect(card).toHaveAttribute('data-task-status', 'ai_done')
    expect(card.querySelector('[data-cove-part="window-plate"]')).toHaveAttribute(
      'data-cove-kind',
      'plan',
    )
    expect(card.querySelector('.task-node__plate')).toHaveAttribute('data-cove-part', 'window-body')
    expect(within(card).getByText('Release notes')).toBeInTheDocument()
  })

  it('shows how far the task had come, without letting it move', () => {
    const card = renderArchivedTask({ status: 'ai_done' })

    const progress = within(card).getByRole('img', { name: 'Task status: AI_DONE' })
    expect(
      Array.from(progress.querySelectorAll<HTMLElement>('.task-node__step')).map(
        cell => cell.dataset.filled,
      ),
    ).toEqual(['true', 'true', 'true', 'false'])
    expect(within(card).queryAllByRole('radio')).toHaveLength(0)
    expect(within(card).queryByRole('button')).toBeNull()
  })

  it('flags the priority, lists the tags and keeps the requirement readable', () => {
    const card = renderArchivedTask({ priority: 'urgent', tags: ['release', 'docs'] })

    const priority = card.querySelector('.task-node__priority')
    expect(priority).toHaveClass('task-node__priority--urgent')
    expect(priority).toHaveTextContent('URGENT')
    expect(priority?.querySelector('svg[data-cove-pixel-icon="flag"]')).not.toBeNull()
    expect(
      Array.from(card.querySelectorAll('.task-node__tag')).map(tag => tag.textContent),
    ).toEqual(['#release', '#docs'])

    const requirement = within(card).getByRole('textbox', { name: 'Task Requirement' })
    expect(requirement).toHaveValue('Write the round 4 release notes.')
    expect(requirement).toHaveAttribute('readonly')
    expect(within(card).queryByText('Task Requirement')).toBeNull()
  })

  it('shows its Agent session as an avatar, and has nothing to run', () => {
    const card = renderArchivedTask({
      linkedAgent: {
        nodeId: 'agent-1',
        title: 'codex · gpt-6.1-sol',
        status: 'exited',
        provider: 'codex',
        model: 'gpt-6.1-sol',
        effectiveModel: 'gpt-6.1-sol',
        resumeSessionId: 'resume-1',
        resumeSessionIdVerified: true,
        startedAt: '2026-11-08T11:00:00.000Z',
      },
    })

    const avatar = within(card).getByRole('img', { name: 'codex · gpt-6.1-sol · Exited' })
    expect(avatar).toHaveClass('task-node__session', 'task-node__session--linked')
    expect(avatar.querySelector('.task-node__session-light--standby')).not.toBeNull()
    expect(card.querySelector('.task-node__sessions')).toHaveTextContent('1 session')
    expect(within(card).queryByText('Agent Sessions')).toBeNull()
    expect(within(card).queryByTestId('task-node-run-agent')).toBeNull()
  })

  it('says when the task had no session', () => {
    const card = renderArchivedTask({ linkedAgent: null })

    expect(card.querySelector('.task-node__sessions')).toHaveTextContent('No sessions')
    expect(card.querySelector('.task-node__session')).toBeNull()
  })
})
