import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WindowFocusState } from '@shared/contracts/dto'
import { applyUiLanguage } from '@app/renderer/i18n'
import { useAgentAttentionStore } from '../store/useAgentAttentionStore'
import type { AgentActivitySummary } from '../utils/agentActivitySummary'
import type { AgentStandbyNotification } from '../utils/agentStandbyNotification'
import { AgentIsland } from './AgentIsland'
import { AGENT_ISLAND_CARD_MS, AGENT_ISLAND_RETRACT_MS } from './AgentIslandCard'

const PILL_RECT = { left: 600, top: 8, width: 80, height: 24 }
const ICON_RECT = { left: 420, top: 60, width: 40, height: 40 }

function rect({ left, top, width, height }: typeof PILL_RECT): DOMRect {
  return {
    left,
    top,
    width,
    height,
    x: left,
    y: top,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect
}

function notification(nodeId: string, title: string, createdAt: number): AgentStandbyNotification {
  return {
    kind: 'agent-standby',
    id: `standby:${nodeId}`,
    sessionId: `session-${nodeId}`,
    workspaceId: 'alpha',
    workspaceName: 'Alpha',
    workspacePath: '/tmp/alpha',
    nodeId,
    title,
    taskId: null,
    taskTitle: 'Trace flaky status',
    spaceId: 'space-1',
    spaceName: 'PR Space',
    spaceDirectoryPath: null,
    executionDirectory: '/tmp/alpha',
    gitContext: { kind: 'branch', name: 'feat/island' },
    pullRequest: { number: 123, title: 'Island cards', url: null },
    createdAt,
  }
}

const summary: AgentActivitySummary = {
  waiting: [
    {
      workspaceId: 'alpha',
      projectName: 'Alpha',
      projectIconId: 'code',
      nodeId: 'n-1',
      title: 'codex · Fix tests',
      spaceName: 'PR Space',
      provider: 'codex',
    },
  ],
  working: [],
}

const showAll = { showTask: true, showSpace: true, showBranch: true, showPullRequest: true }

let focusListeners = new Set<(state: WindowFocusState) => void>()

function stubWindowFocus(isFocused: boolean): void {
  focusListeners = new Set()
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      windowChrome: {
        getFocus: () => Promise.resolve({ isFocused }),
        onFocusChange: (listener: (state: WindowFocusState) => void) => {
          focusListeners.add(listener)
          return () => focusListeners.delete(listener)
        },
      },
    },
  })
}

function stubReducedMotion(reduce: boolean): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    }),
  })
}

function seed(notifications: AgentStandbyNotification[]): void {
  useAgentAttentionStore.setState({ notifications })
}

function announce(item: AgentStandbyNotification): void {
  act(() => useAgentAttentionStore.getState().setNotifications(previous => [item, ...previous]))
}

const pending = () => useAgentAttentionStore.getState().notifications.map(item => item.id)

/** The island on the attention store, as the shell mounts it. */
function Harness({
  isListOpen = false,
  onActivate = vi.fn(),
  onDismiss = vi.fn(),
}: {
  isListOpen?: boolean
  onActivate?: (notification: AgentStandbyNotification) => void
  onDismiss?: (id: string) => void
}): React.JSX.Element {
  const pillRef = React.useRef<HTMLButtonElement | null>(null)
  const notifications = useAgentAttentionStore(state => state.notifications)
  const dismiss = React.useCallback(
    (id: string) => {
      onDismiss(id)
      useAgentAttentionStore.getState().dismiss(id)
    },
    [onDismiss],
  )
  return (
    <>
      <button ref={pillRef} data-testid="pill">
        pill
      </button>
      <AgentIsland
        notifications={notifications}
        summary={summary}
        pillRef={pillRef}
        isListOpen={isListOpen}
        contextVisibility={showAll}
        onActivate={onActivate}
        onDismiss={dismiss}
      />
    </>
  )
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

/** Each call flushes React, so a timer that a fired timer's update starts needs its own call. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms)
  })
}

const cards = () => Array.from(document.querySelectorAll<HTMLElement>('[data-island-card]'))
const sparks = () => document.querySelector('[data-testid="agent-island-sparks"]')

describe('AgentIsland', () => {
  beforeEach(() => {
    applyUiLanguage('en')
    vi.useFakeTimers({
      toFake: [
        'setTimeout',
        'clearTimeout',
        'Date',
        'performance',
        'requestAnimationFrame',
        'cancelAnimationFrame',
      ],
    })
    stubWindowFocus(true)
    stubReducedMotion(false)
    seed([])
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      return rect(this.matches('[data-testid="pill"]') ? PILL_RECT : ICON_RECT)
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('shows the three newest, the older ones tucked behind the front card', async () => {
    seed([
      notification('n-4', 'codex · Fourth', 4),
      notification('n-3', 'codex · Third', 3),
      notification('n-2', 'codex · Second', 2),
      notification('n-1', 'codex · Fix tests', 1),
    ])
    render(<Harness />)
    await settle()

    expect(cards().map(card => card.dataset.islandCard)).toEqual([
      'standby:n-4:4',
      'standby:n-3:3',
      'standby:n-2:2',
    ])
    expect(cards().map(card => card.dataset.tucked ?? 'front')).toEqual(['front', 'true', 'true'])
    expect(screen.getByText('codex · Fourth')).toBeTruthy()
    expect(screen.getByTestId('app-notifications').dataset.fanned).toBe('false')
  })

  it('sends a card pushed past the third into the pill, not back on screen later', async () => {
    seed([
      notification('n-3', 'codex · Third', 3),
      notification('n-2', 'codex · Second', 2),
      notification('n-1', 'codex · First', 1),
    ])
    render(<Harness />)
    await settle()

    announce(notification('n-4', 'codex · Fourth', 4))
    expect(cards().map(card => card.dataset.islandCard)).toEqual([
      'standby:n-4:4',
      'standby:n-3:3',
      'standby:n-2:2',
    ])

    advance(AGENT_ISLAND_CARD_MS)
    advance(AGENT_ISLAND_RETRACT_MS)
    expect(screen.queryByTestId('app-notifications')).toBeNull()
    expect(pending()).toEqual(['standby:n-4', 'standby:n-3', 'standby:n-2', 'standby:n-1'])
  })

  it('sits under the pill, its right edge on the pill’s', async () => {
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness />)
    await settle()

    const stack = screen.getByTestId('app-notifications')
    // happy-dom lays nothing out, so the stack is 0 wide and its left is the pill's right.
    expect(stack.style.left).toBe(`${PILL_RECT.left + PILL_RECT.width}px`)
    expect(stack.style.top).toBe(`${PILL_RECT.top + PILL_RECT.height + 8}px`)
    expect(stack.style.right).toBe('auto')
  })

  it('reads the waiting state and context on the card', async () => {
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness />)
    await settle()

    expect(screen.getByText('Waiting for your input')).toBeTruthy()
    expect(screen.getByTestId('app-notification-chip-project').textContent).toBe('Alpha')
    expect(screen.getByTestId('app-notification-chip-task').textContent).toBe('Trace flaky status')
    expect(screen.getByTestId('app-notification-chip-space').textContent).toBe('PR Space')
    expect(screen.getByTestId('app-notification-chip-branch').textContent).toBe('feat/island')
    expect(screen.getByTestId('app-notification-chip-pr').textContent).toBe('#123')
  })

  it('goes to the Agent when the card is clicked', async () => {
    const onActivate = vi.fn()
    const item = notification('n-1', 'codex · Fix tests', 1)
    seed([item])
    render(<Harness onActivate={onActivate} />)
    await settle()

    fireEvent.click(screen.getByText('codex · Fix tests'))
    expect(onActivate).toHaveBeenCalledWith(item)
  })

  it('folds up on ✕, then answers the Agent', async () => {
    const onDismiss = vi.fn()
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness onDismiss={onDismiss} />)
    await settle()

    fireEvent.click(screen.getByTestId('app-notification-close-standby:n-1'))
    expect(cards()[0]?.dataset.leaving).toBe('true')
    expect(onDismiss).not.toHaveBeenCalled()

    advance(AGENT_ISLAND_RETRACT_MS)
    expect(onDismiss).toHaveBeenCalledWith('standby:n-1')
    expect(pending()).toEqual([])
    expect(screen.queryByTestId('app-notifications')).toBeNull()
  })

  it('retracts into the pill after six seconds of unpaused time, the Agent still waiting', async () => {
    const onDismiss = vi.fn()
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness onDismiss={onDismiss} />)
    await settle()

    advance(AGENT_ISLAND_CARD_MS - 1)
    expect(cards()[0]?.dataset.leaving).toBeUndefined()
    advance(1)
    expect(cards()[0]?.dataset.leaving).toBe('true')
    advance(AGENT_ISLAND_RETRACT_MS)
    expect(screen.queryByTestId('app-notifications')).toBeNull()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(pending()).toEqual(['standby:n-1'])
  })

  it('grows a new card when the same Agent ends another turn', async () => {
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness />)
    await settle()
    advance(AGENT_ISLAND_CARD_MS)
    advance(AGENT_ISLAND_RETRACT_MS)
    expect(cards()).toHaveLength(0)

    // Working again clears it; the next turn it ends is a new card.
    act(() => useAgentAttentionStore.getState().dismiss('standby:n-1'))
    announce(notification('n-1', 'codex · Fix tests', 2))
    expect(cards().map(card => card.dataset.islandCard)).toEqual(['standby:n-1:2'])
  })

  it('holds every countdown while the pointer rests on the stack, and fans the cards out', async () => {
    seed([notification('n-2', 'codex · Second', 2), notification('n-1', 'codex · First', 1)])
    render(<Harness />)
    await settle()

    advance(2_000)
    const stack = screen.getByTestId('app-notifications')
    fireEvent.pointerEnter(stack)
    expect(stack.dataset.paused).toBe('true')
    expect(stack.dataset.fanned).toBe('true')
    expect(cards().every(card => card.dataset.tucked === undefined)).toBe(true)

    advance(60_000)
    expect(cards()).toHaveLength(2)

    fireEvent.pointerLeave(stack)
    advance(AGENT_ISLAND_CARD_MS - 2_000 - 1)
    expect(cards().every(card => card.dataset.leaving === undefined)).toBe(true)
    advance(1)
    advance(AGENT_ISLAND_RETRACT_MS)
    expect(screen.queryByTestId('app-notifications')).toBeNull()
    expect(pending()).toHaveLength(2)
  })

  it('holds the countdown while focus is inside the stack', async () => {
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness />)
    await settle()

    act(() => screen.getByTestId('app-notification-close-standby:n-1').focus())
    expect(screen.getByTestId('app-notifications').dataset.paused).toBe('true')
    advance(AGENT_ISLAND_CARD_MS * 2)
    expect(cards()[0]?.dataset.leaving).toBeUndefined()
  })

  it('holds the countdown while OpenCove is behind another app', async () => {
    stubWindowFocus(false)
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness />)
    await settle()

    expect(screen.getByTestId('app-notifications').dataset.paused).toBe('true')
    advance(AGENT_ISLAND_CARD_MS * 2)
    expect(cards()).toHaveLength(1)

    act(() => focusListeners.forEach(listener => listener({ isFocused: true })))
    advance(AGENT_ISLAND_CARD_MS)
    advance(AGENT_ISLAND_RETRACT_MS)
    expect(screen.queryByTestId('app-notifications')).toBeNull()
    expect(pending()).toEqual(['standby:n-1'])
  })

  it('folds every card into the list when the list opens, answering none', async () => {
    const onDismiss = vi.fn()
    seed([notification('n-2', 'codex · Second', 2), notification('n-1', 'codex · First', 1)])
    const { rerender } = render(<Harness onDismiss={onDismiss} />)
    await settle()

    rerender(<Harness onDismiss={onDismiss} isListOpen />)
    expect(screen.queryByTestId('app-notifications')).toBeNull()
    // What arrives while the list is open is in the list already.
    announce(notification('n-3', 'codex · Third', 3))
    rerender(<Harness onDismiss={onDismiss} />)
    expect(screen.queryByTestId('app-notifications')).toBeNull()
    expect(onDismiss).not.toHaveBeenCalled()
    expect(pending()).toHaveLength(3)

    announce(notification('n-4', 'codex · Fourth', 4))
    expect(cards().map(card => card.dataset.islandCard)).toEqual(['standby:n-4:4'])
  })

  it('flies sparks into a new card once, on a canvas that leaves with the last spark', async () => {
    seed([notification('n-1', 'codex · Fix tests', 1)])
    const { rerender } = render(<Harness />)
    await settle()

    const canvas = sparks() as HTMLCanvasElement | null
    expect(canvas).not.toBeNull()
    // The canvas spans the pill and the icon, with room for the bow.
    expect(Number.parseFloat(canvas!.style.left)).toBeLessThanOrEqual(ICON_RECT.left)
    expect(Number.parseFloat(canvas!.style.top)).toBeLessThanOrEqual(PILL_RECT.top)

    advance(4_000)
    expect(sparks()).toBeNull()

    // A re-render of the same card sends nothing more.
    fireEvent.pointerEnter(screen.getByTestId('app-notifications'))
    rerender(<Harness />)
    expect(sparks()).toBeNull()
  })

  it('draws no sparks under reduced motion', async () => {
    stubReducedMotion(true)
    seed([notification('n-1', 'codex · Fix tests', 1)])
    render(<Harness />)
    await settle()

    expect(cards()).toHaveLength(1)
    expect(sparks()).toBeNull()
  })
})
