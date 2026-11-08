import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { useWindowFocused } from '../hooks/useWindowFocused'
import type { AgentActivityReference, AgentActivitySummary } from '../utils/agentActivitySummary'
import {
  AGENT_ISLAND_MAX_CARDS,
  type AgentStandbyCardContextVisibility,
  type AgentStandbyNotification,
} from '../utils/agentStandbyNotification'
import { AgentIslandCard, islandCardKey, type AgentIslandCardLayout } from './AgentIslandCard'
import { AgentIslandSparks, type AgentIslandSparksHandle } from './AgentIslandSparks'

/** The gap between the pill and the stack, and between expanded cards. */
const GAP_PX = 8
/** How much of each tucked card shows below the one in front. */
const PEEK_PX = 8
const TUCK_SCALE_STEP = 0.04
/** The stack keeps this far from the window's edges. */
const EDGE_PX = 12
const SPARK_FALLBACK_COLORS = ['#a78bfa', '#f5c451']

function prefersReducedMotion(): boolean {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
}

function findLive(
  summary: AgentActivitySummary,
  notification: AgentStandbyNotification,
): AgentActivityReference | null {
  const matches = (item: AgentActivityReference) =>
    item.workspaceId === notification.workspaceId && item.nodeId === notification.nodeId
  return summary.waiting.find(matches) ?? summary.working.find(matches) ?? null
}

/** Under the pill, its right edge on the pill's, kept inside the window. */
function placeStack(stack: HTMLElement, pill: HTMLElement | null): void {
  const rect = pill?.isConnected ? pill.getBoundingClientRect() : null
  if (!rect || rect.width === 0) {
    stack.style.removeProperty('left')
    stack.style.removeProperty('right')
    stack.style.removeProperty('top')
    return
  }
  const width = stack.offsetWidth
  const left = Math.max(EDGE_PX, Math.min(rect.right - width, window.innerWidth - EDGE_PX - width))
  stack.style.left = `${Math.round(left)}px`
  stack.style.right = 'auto'
  stack.style.top = `${Math.round(rect.bottom + GAP_PX)}px`
}

function sameKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  return a.size === b.size && [...a].every(key => b.has(key))
}

function sparkColors(stack: HTMLElement): string[] {
  const style = window.getComputedStyle(stack)
  return ['--cove-kind-ai-glyph', '--cove-status-waiting'].map(
    (name, index) => style.getPropertyValue(name).trim() || SPARK_FALLBACK_COLORS[index]!,
  )
}

/**
 * The agent island's cards (docs/ui/AGENT_ISLAND.md): each Agent that ends a turn you have not
 * answered grows a card out of the pill, with sparks flying from the pill into its icon. At
 * most three show, the older ones tucked behind the newest; pointing at or focusing the stack
 * fans them out and holds every countdown, as does OpenCove being behind another app.
 * A card that runs out, or that a newer one pushes past the third, retracts into the pill: the
 * Agent still waits there. Opening the pill's list folds every card into it the same way.
 * Only ✕ and going to the Agent answer it.
 */
export function AgentIsland({
  notifications,
  summary,
  pillRef,
  isListOpen,
  contextVisibility,
  onActivate,
  onDismiss,
}: {
  /** Newest first. */
  notifications: AgentStandbyNotification[]
  summary: AgentActivitySummary
  pillRef: React.RefObject<HTMLElement | null>
  isListOpen: boolean
  contextVisibility: AgentStandbyCardContextVisibility
  /** Goes to the Agent, which answers it. */
  onActivate: (notification: AgentStandbyNotification) => void
  /** ✕: answers the Agent where it is. */
  onDismiss: (id: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const isWindowFocused = useWindowFocused()
  const stackRef = React.useRef<HTMLElement | null>(null)
  const sparksRef = React.useRef<AgentIslandSparksHandle | null>(null)
  const announcedRef = React.useRef(new Set<string>())
  const [isHovered, setIsHovered] = React.useState(false)
  const [hasFocusWithin, setHasFocusWithin] = React.useState(false)
  const [heights, setHeights] = React.useState<ReadonlyMap<string, number>>(() => new Map())
  /** Cards back in the pill, by `islandCardKey`; their Agents still wait. */
  const [retracted, setRetracted] = React.useState<ReadonlySet<string>>(() => new Set())

  const cards = React.useMemo(
    () =>
      isListOpen
        ? []
        : notifications
            .filter(notification => !retracted.has(islandCardKey(notification)))
            .slice(0, AGENT_ISLAND_MAX_CARDS),
    [isListOpen, notifications, retracted],
  )
  const isEngaged = isHovered || hasFocusWithin
  const paused = isEngaged || !isWindowFocused

  // Forget answered Agents. The list holds every Agent, so opening it folds the cards into it;
  // otherwise a card pushed past the third goes back into the pill rather than wait its turn.
  React.useEffect(() => {
    setRetracted(previous => {
      const next = new Set<string>()
      let shown = 0
      for (const notification of notifications) {
        const key = islandCardKey(notification)
        if (isListOpen || previous.has(key) || shown === AGENT_ISLAND_MAX_CARDS) {
          next.add(key)
        } else {
          shown += 1
        }
      }
      return sameKeys(next, previous) ? previous : next
    })
  }, [isListOpen, notifications])

  const handleRetract = React.useCallback((notification: AgentStandbyNotification) => {
    setRetracted(previous => new Set(previous).add(islandCardKey(notification)))
  }, [])
  const handleDismiss = React.useCallback(
    (notification: AgentStandbyNotification) => onDismiss(notification.id),
    [onDismiss],
  )

  // An empty stack is gone, and with it the pointer and focus it held.
  React.useEffect(() => {
    if (cards.length === 0) {
      setIsHovered(false)
      setHasFocusWithin(false)
    }
    setHeights(previous => {
      const kept = [...previous].filter(([key]) => cards.some(card => islandCardKey(card) === key))
      return kept.length === previous.size ? previous : new Map(kept)
    })
  }, [cards])

  const handleHeight = React.useCallback((key: string, height: number) => {
    setHeights(previous =>
      previous.get(key) === height ? previous : new Map(previous).set(key, height),
    )
  }, [])

  // Place the stack before paint, then send sparks into a newly arrived front card's icon.
  React.useLayoutEffect(() => {
    const stack = stackRef.current
    const announced = announcedRef.current
    const present = new Set(cards.map(islandCardKey))
    announced.forEach(id => {
      if (!present.has(id)) {
        announced.delete(id)
      }
    })
    if (!stack) {
      return undefined
    }

    const place = () => placeStack(stack, pillRef.current)
    place()

    const front = cards[0]
    const fresh = cards.filter(card => !announced.has(islandCardKey(card)))
    fresh.forEach(card => announced.add(islandCardKey(card)))
    if (front && fresh.includes(front) && !prefersReducedMotion()) {
      const pill = pillRef.current
      const icon = stack.querySelector<HTMLElement>(
        `[data-island-card="${CSS.escape(islandCardKey(front))}"] .agent-activity-mark`,
      )
      const from = pill?.isConnected ? pill.getBoundingClientRect() : null
      const to = icon?.getBoundingClientRect() ?? null
      if (from && to && from.width > 0 && to.width > 0) {
        sparksRef.current?.spawn(
          from,
          { x: to.left + to.width / 2, y: to.top + to.height / 2 },
          sparkColors(stack),
        )
      }
    }

    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [cards, pillRef])

  const frontHeight = cards[0] ? (heights.get(islandCardKey(cards[0])) ?? 0) : 0
  const isFanned = isEngaged && cards.length > 1
  let offset = 0
  const layouts = cards.map((card, index): AgentIslandCardLayout => {
    const zIndex = cards.length - index
    const y = isFanned ? offset : index * PEEK_PX
    offset += (heights.get(islandCardKey(card)) ?? frontHeight) + GAP_PX
    if (isFanned || index === 0) {
      return { y, scale: 1, height: null, isTucked: false, zIndex }
    }
    return { y, scale: 1 - index * TUCK_SCALE_STEP, height: frontHeight, isTucked: true, zIndex }
  })
  const stackHeight = isFanned ? offset - GAP_PX : frontHeight + PEEK_PX * (cards.length - 1)

  return (
    <>
      {cards.length > 0 ? (
        <section
          ref={stackRef}
          className="app-notifications agent-island"
          data-testid="app-notifications"
          data-fanned={isFanned ? 'true' : 'false'}
          data-paused={paused ? 'true' : 'false'}
          aria-label={t('agentIsland.region')}
          aria-live="polite"
          style={{ height: stackHeight }}
          onPointerEnter={() => setIsHovered(true)}
          onPointerLeave={() => setIsHovered(false)}
          onFocus={() => setHasFocusWithin(true)}
          onBlur={event => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
              setHasFocusWithin(false)
            }
          }}
        >
          {cards.map((card, index) => (
            <AgentIslandCard
              key={islandCardKey(card)}
              notification={card}
              live={findLive(summary, card)}
              contextVisibility={contextVisibility}
              layout={layouts[index]!}
              paused={paused}
              onHeight={handleHeight}
              onActivate={onActivate}
              onRetract={handleRetract}
              onDismiss={handleDismiss}
            />
          ))}
        </section>
      ) : null}
      <AgentIslandSparks ref={sparksRef} />
    </>
  )
}
