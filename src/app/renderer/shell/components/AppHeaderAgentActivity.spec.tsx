import React from 'react'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import type { AgentActivityReference, AgentActivitySummary } from '../utils/agentActivitySummary'
import { AppHeaderAgentActivity } from './AppHeaderAgentActivity'

function agent(workspaceId: string, nodeId: string, title: string): AgentActivityReference {
  return {
    workspaceId,
    projectName: workspaceId,
    projectIconId: null,
    nodeId,
    title,
    spaceName: null,
    provider: 'codex',
  }
}

const busy: AgentActivitySummary = {
  waiting: [agent('alpha', 'a-2', 'Review API'), agent('beta', 'b-1', 'Fix login')],
  working: [agent('alpha', 'a-1', 'Write docs')],
}

function Harness({
  summary,
  canPreviewOnHover,
  onFocusAgent = vi.fn(),
}: {
  summary: AgentActivitySummary
  canPreviewOnHover?: boolean
  onFocusAgent?: (workspaceId: string, nodeId: string) => void
}): React.JSX.Element {
  const [isOpen, setIsOpen] = React.useState(false)
  return (
    <AppHeaderAgentActivity
      summary={summary}
      isOpen={isOpen}
      onOpenChange={setIsOpen}
      canPreviewOnHover={canPreviewOnHover}
      onFocusAgent={onFocusAgent}
    />
  )
}

const pill = () => screen.getByTestId('app-header-agent-activity')
const list = () => screen.queryByTestId('app-header-agent-activity-list')

describe('AppHeaderAgentActivity', () => {
  beforeEach(async () => {
    await applyUiLanguage('en')
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('says how many agents wait, with their marks, and opens the list on click', () => {
    render(<Harness summary={busy} />)
    expect(pill()).toHaveAccessibleName('2 agents waiting. Show agents')
    expect(pill()).toHaveTextContent('2 waiting')
    expect(pill()).toHaveAttribute('data-tone', 'waiting')
    expect(pill()).toHaveAttribute('aria-expanded', 'false')
    expect(pill().querySelectorAll('[data-cove-part="kind-tile"]')).toHaveLength(2)

    fireEvent.click(pill())
    expect(pill()).toHaveAttribute('aria-expanded', 'true')
    const sections = within(list()!).getAllByRole('group')
    expect(sections.map(section => section.getAttribute('aria-label'))).toEqual([
      'Waiting for you',
      'Working',
    ])
    expect(
      within(sections[0]!)
        .getAllByRole('button')
        .map(row => row.textContent),
    ).toEqual([expect.stringContaining('Review API'), expect.stringContaining('Fix login')])
  })

  it('jumps to the agent a row names and closes', () => {
    const onFocusAgent = vi.fn()
    render(<Harness summary={busy} onFocusAgent={onFocusAgent} />)
    fireEvent.click(pill())
    fireEvent.click(within(list()!).getByRole('button', { name: /Fix login/ }))
    expect(onFocusAgent).toHaveBeenCalledWith('beta', 'b-1')
    expect(list()).toBeNull()
  })

  it('opens after a short hover and stays while the pointer crosses into the list', () => {
    vi.useFakeTimers()
    render(<Harness summary={busy} />)
    fireEvent.pointerEnter(pill(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(100))
    expect(list()).toBeNull()
    act(() => vi.advanceTimersByTime(60))
    expect(list()).not.toBeNull()

    fireEvent.pointerLeave(pill(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(200))
    fireEvent.pointerEnter(list()!, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(400))
    expect(list()).not.toBeNull()

    fireEvent.pointerLeave(list()!, { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(310))
    expect(list()).toBeNull()
  })

  it('leaves another open panel alone on hover, but not on click', () => {
    vi.useFakeTimers()
    render(<Harness summary={busy} canPreviewOnHover={false} />)
    fireEvent.pointerEnter(pill(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(400))
    expect(list()).toBeNull()
    fireEvent.click(pill())
    expect(list()).not.toBeNull()
  })

  it('keeps a list it opened by hover once the pill is clicked', () => {
    vi.useFakeTimers()
    render(<Harness summary={busy} />)
    fireEvent.pointerEnter(pill(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(160))
    fireEvent.click(pill())
    fireEvent.pointerLeave(pill(), { pointerType: 'mouse' })
    act(() => vi.advanceTimersByTime(400))
    expect(list()).not.toBeNull()
    fireEvent.click(pill())
    expect(list()).toBeNull()
  })

  it('walks the rows from the keyboard and returns to the pill on Escape', () => {
    vi.useFakeTimers()
    render(<Harness summary={busy} />)
    pill().focus()
    fireEvent.keyDown(pill(), { key: 'ArrowDown' })
    act(() => vi.runOnlyPendingTimers())
    const rows = within(list()!).getAllByRole('button')
    expect(rows[0]).toHaveFocus()
    fireEvent.keyDown(rows[0]!, { key: 'ArrowDown' })
    expect(rows[1]).toHaveFocus()
    fireEvent.keyDown(rows[1]!, { key: 'End' })
    expect(rows[2]).toHaveFocus()
    fireEvent.keyDown(rows[2]!, { key: 'ArrowDown' })
    expect(rows[0]).toHaveFocus()
    fireEvent.keyDown(rows[0]!, { key: 'Escape' })
    expect(list()).toBeNull()
    expect(pill()).toHaveFocus()
  })

  it('shows working agents in a neutral pill, and nothing when idle', () => {
    const { rerender } = render(<Harness summary={{ waiting: [], working: busy.working }} />)
    expect(pill()).toHaveAttribute('data-tone', 'working')
    expect(pill()).toHaveTextContent('1 working')
    fireEvent.click(pill())
    expect(within(list()!).getAllByRole('group')).toHaveLength(1)

    rerender(<Harness summary={{ waiting: [], working: [] }} />)
    expect(screen.queryByTestId('app-header-agent-activity')).toBeNull()
  })
})
