import React from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { TaskNode } from '../../../src/contexts/workspace/presentation/renderer/components/TaskNode'
import type { TaskAgentSessionRecord } from '../../../src/contexts/workspace/presentation/renderer/types'

vi.mock('@xyflow/react', () => {
  return {
    Handle: () => null,
    Position: {
      Left: 'left',
      Right: 'right',
    },
    useStoreApi: () => ({ getState: () => ({ transform: [0, 0, 1] }), subscribe: () => () => {} }),
    useStore: (selector: (state: unknown) => unknown) => selector({ transform: [0, 0, 1] }),
  }
})

function sessionRecord(index: number): TaskAgentSessionRecord {
  const minute = String(index).padStart(2, '0')
  return {
    id: `session-${index}`,
    provider: 'codex',
    resumeSessionId: `resume-${index}`,
    resumeSessionIdVerified: true,
    prompt: 'Write the release notes',
    model: 'gpt-6.1-sol',
    effectiveModel: 'gpt-6.1-sol',
    boundDirectory: '/repo',
    lastDirectory: '/repo',
    createdAt: `2026-11-08T10:${minute}:00.000Z`,
    lastRunAt: `2026-11-08T10:${minute}:00.000Z`,
    endedAt: `2026-11-08T10:${minute}:30.000Z`,
    exitCode: 0,
    status: 'exited',
  }
}

function renderTaskCard(
  overrides: Partial<ComponentProps<typeof TaskNode>> = {},
  onWindowClick: () => void = () => {},
) {
  const props: ComponentProps<typeof TaskNode> = {
    title: 'Release notes',
    requirement: 'Write the round 4 release notes.',
    status: 'doing',
    priority: 'high',
    tags: ['release'],
    isEnriching: false,
    linkedAgentNode: null,
    agentSessions: [],
    currentDirectory: '/repo',
    position: { x: 0, y: 0 },
    width: 420,
    height: 300,
    onClose: vi.fn(),
    onOpenEditor: vi.fn(),
    onQuickTitleSave: vi.fn(),
    onQuickRequirementSave: vi.fn(),
    onRunAgent: vi.fn(),
    onResize: vi.fn(),
    onStatusChange: vi.fn(),
    onResumeAgentSession: vi.fn(),
    onRemoveAgentSessionRecord: vi.fn(),
    ...overrides,
  }
  render(
    // Stands in for the canvas's node wrapper, which selects the window on click.
    <div onClick={onWindowClick}>
      <TaskNode {...props} />
    </div>,
  )
  return props
}

afterEach(() => {
  useAppStore.setState({ focusRequest: null })
})

describe('Task card: status steps', () => {
  it('shows how far the task has come as four steps, filled up to its status', () => {
    renderTaskCard({ status: 'ai_done' })

    const steps = screen.getByRole('radiogroup', { name: 'Task status' })
    const radios = within(steps).getAllByRole<HTMLInputElement>('radio')
    expect(radios.map(radio => radio.getAttribute('aria-label'))).toEqual([
      'TODO',
      'DOING',
      'AI_DONE',
      'DONE',
    ])
    expect(radios.map(radio => radio.checked)).toEqual([false, false, true, false])
    expect(
      Array.from(steps.querySelectorAll<HTMLElement>('.task-node__step')).map(
        cell => cell.dataset.filled,
      ),
    ).toEqual(['true', 'true', 'true', 'false'])
  })

  it('moves the task to a step when it is clicked, and not when the current step is', () => {
    const { onStatusChange } = renderTaskCard({ status: 'doing' })

    fireEvent.click(screen.getByTestId('task-node-status-step-done'))
    expect(onStatusChange).toHaveBeenLastCalledWith('done')

    fireEvent.click(screen.getByTestId('task-node-status-step-doing'))
    expect(onStatusChange).toHaveBeenCalledTimes(1)
  })

  it('keeps step clicks to itself, so a step never selects the window', () => {
    // Arrow keys on a radio fire a click; reaching the canvas it would select the window, whose
    // selection box then takes focus from the steps.
    const onWindowClick = vi.fn()
    const { onStatusChange } = renderTaskCard({ status: 'doing' }, onWindowClick)

    fireEvent.click(screen.getByTestId('task-node-status-step-ai_done'))
    expect(onStatusChange).toHaveBeenLastCalledWith('ai_done')
    expect(onWindowClick).not.toHaveBeenCalled()
  })

  it('keeps the status menu beside the steps', () => {
    renderTaskCard({ status: 'doing' })

    expect(screen.getByTestId('task-node-status-select-trigger')).toHaveTextContent('DOING')
    expect(screen.getByTestId('task-node-meta')).toContainElement(
      screen.getByTestId('task-node-status-select-trigger'),
    )
  })
})

describe('Task card: the card itself', () => {
  it('makes the title bar the drag surface: a click renames, a hold or a drag moves', () => {
    const onWindowClick = vi.fn()
    renderTaskCard({}, onWindowClick)

    const display = screen.getByTestId('task-node-title-display')
    expect(display).toHaveAttribute('data-cove-title-gesture', 'move')
    expect(display).not.toHaveClass('nodrag')
    expect(document.querySelector('.task-node__header .cove-window-header__drag')).toBeNull()

    fireEvent.click(display)
    expect(screen.getByTestId('task-node-inline-title-input')).toHaveValue('Release notes')
    expect(onWindowClick).not.toHaveBeenCalled()
  })

  it('flags the priority with a pixel flag', () => {
    renderTaskCard({ priority: 'urgent' })

    const priority = screen.getByTestId('task-node-priority')
    expect(priority).toHaveClass('task-node__priority--urgent')
    expect(priority).toHaveTextContent('URGENT')
    expect(priority.querySelector('svg[data-cove-pixel-icon="flag"]')).not.toBeNull()
  })

  it('lets the requirement fill the card with no label above it', () => {
    renderTaskCard({ requirement: '' })

    const requirement = screen.getByTestId('task-node-inline-requirement-input')
    expect(requirement).toHaveAttribute('aria-label', 'Task Requirement')
    expect(requirement).toHaveAttribute('placeholder', 'What needs doing? Drop files to add paths.')
    expect(screen.queryByText('Task Requirement')).toBeNull()
  })

  it('runs the task from the bottom row', () => {
    const { onRunAgent } = renderTaskCard()

    const run = screen.getByTestId('task-node-run-agent')
    expect(run).toHaveTextContent('Run')
    expect(run.querySelector('svg[data-cove-pixel-icon="play"]')).not.toBeNull()
    fireEvent.click(run)
    expect(onRunAgent).toHaveBeenCalledTimes(1)
  })
})

describe('Task card: sessions as avatars', () => {
  it('says where sessions will appear before the first run', () => {
    renderTaskCard()

    expect(screen.getByTestId('task-node-agent-sessions')).toHaveTextContent(
      'No sessions yet. Run to start one.',
    )
  })

  it('shows each session as an avatar, the running one with a live light', () => {
    renderTaskCard({
      linkedAgentNode: {
        nodeId: 'agent-1',
        title: 'Release notes',
        provider: 'claude-code',
        status: 'running',
        startedAt: '2026-11-08T11:00:00.000Z',
      },
      agentSessions: [sessionRecord(1)],
    })

    const linked = screen.getByTestId('task-node-agent-session-linked-agent-1')
    const record = screen.getByTestId('task-node-agent-session-record-session-1')
    expect(linked.tagName).toBe('BUTTON')
    expect(linked).toHaveAttribute('aria-label', 'Release notes · Working · 2026-11-08 11:00')
    expect(linked.querySelector('.task-node__session-light--working')).not.toBeNull()
    expect(record).toHaveAttribute('aria-label', 'Codex · gpt-6.1-sol · Exited · 2026-11-08 10:01')
    expect(record.querySelector('.task-node__session-light--standby')).not.toBeNull()
    expect(screen.getByTestId('task-node-agent-sessions')).toHaveTextContent(
      '2 sessions · 1 running',
    )
  })

  it('opens the linked Agent window when its avatar is clicked', () => {
    useAppStore.setState({ activeWorkspaceId: 'workspace-1', focusRequest: null })
    renderTaskCard({
      linkedAgentNode: {
        nodeId: 'agent-1',
        title: 'Release notes',
        provider: 'codex',
        status: 'running',
        startedAt: null,
      },
    })

    fireEvent.click(screen.getByTestId('task-node-agent-session-linked-agent-1'))
    expect(useAppStore.getState().focusRequest).toMatchObject({
      kind: 'node',
      workspaceId: 'workspace-1',
      nodeId: 'agent-1',
    })
  })

  it('opens a past session’s menu when its avatar is clicked', () => {
    const { onResumeAgentSession } = renderTaskCard({ agentSessions: [sessionRecord(1)] })

    fireEvent.click(screen.getByTestId('task-node-agent-session-record-session-1'))
    fireEvent.click(screen.getByTestId('task-node-agent-session-menu-resume-session-1'))
    fireEvent.click(screen.getByTestId('task-node-agent-session-resume-confirm-resume-session-1'))
    expect(onResumeAgentSession).toHaveBeenCalledWith('session-1')
  })

  it('shows every session of a default-width card as an avatar', () => {
    // A task window opens two grid columns wide: 252px at the regular size.
    renderTaskCard({ width: 252, agentSessions: [1, 2, 3, 4].map(sessionRecord) })

    expect(screen.getAllByTestId(/^task-node-agent-session-record-/)).toHaveLength(4)
    expect(screen.queryByTestId('task-node-agent-session-more')).toBeNull()
  })

  it('folds the sessions that do not fit into one more avatar', () => {
    const { onRemoveAgentSessionRecord } = renderTaskCard({
      width: 220,
      agentSessions: [1, 2, 3, 4, 5, 6].map(sessionRecord),
    })

    const sessions = screen.getByTestId('task-node-agent-sessions')
    // Newest first; a card at the 220px minimum holds three avatars, the last of them the fold.
    expect(
      within(sessions)
        .getAllByTestId(/^task-node-agent-session-record-/)
        .map(avatar => avatar.dataset.testid),
    ).toEqual([
      'task-node-agent-session-record-session-6',
      'task-node-agent-session-record-session-5',
    ])
    const more = screen.getByTestId('task-node-agent-session-more')
    expect(more).toHaveTextContent('+4')
    expect(more).toHaveAttribute('aria-label', '4 more sessions')

    fireEvent.click(more)
    const list = screen.getByTestId('task-node-agent-session-menu')
    expect(
      within(list)
        .getAllByRole('menuitem')
        .map(item => item.textContent),
    ).toEqual([
      'Codex · gpt-6.1-sol · 2026-11-08 10:04',
      'Codex · gpt-6.1-sol · 2026-11-08 10:03',
      'Codex · gpt-6.1-sol · 2026-11-08 10:02',
      'Codex · gpt-6.1-sol · 2026-11-08 10:01',
    ])

    fireEvent.click(within(list).getAllByRole('menuitem')[3]!)
    fireEvent.click(screen.getByTestId('task-node-agent-session-menu-remove-session-1'))
    expect(onRemoveAgentSessionRecord).toHaveBeenCalledWith('session-1')
  })
})

describe('Task card: action errors', () => {
  it.each(['todo', 'doing', 'ai_done', 'done'] as const)(
    'shows the existing error guidance in %s without a status gate',
    status => {
      renderTaskCard({ status, lastError: 'Rephrase the task. Your text has been kept.' })
      expect(screen.getByRole('alert')).toBeVisible()
      expect(screen.getByRole('alert')).toHaveTextContent('Rephrase the task')
      expect(screen.getByRole('alert')).toHaveClass('cove-window__error', 'task-node__error')
      expect(screen.getByTestId('task-node-inline-requirement-input')).not.toBeDisabled()
    },
  )
  it('does not show an empty error block', () => {
    renderTaskCard({ lastError: null })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
