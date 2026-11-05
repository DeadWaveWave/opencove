import type React from 'react'
import type { LabelColor } from '@shared/types/labelColor'
import type { KeyChordDescription } from '@contexts/settings/domain/keybindings'
import type { StatusPillTone } from '@app/renderer/components/ui/StatusPill'

export type CommandCenterItem = {
  id: string
  title: string
  keywords?: string
  icon: React.JSX.Element
  labelColor?: LabelColor | null
  remoteLabel?: string
  isCurrent?: boolean
  showCurrentMarker?: boolean
  /** A second line, such as where a window lives. */
  subtitle?: string
  /** Trailing text, such as the Space a window lives in. */
  trailing?: string
  /** An agent's state, shown as a pill in place of the trailing text. */
  status?: { tone: StatusPillTone; label: string }
  shortcut?: KeyChordDescription | null
  tone?: 'waiting'
  onSelect: () => void
}

export type CommandCenterSection = {
  id: string
  label: string
  items: CommandCenterItem[]
  /** Stays first while searching, as "Needs you" does. */
  pinned?: boolean
}

export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase()
}

function fuzzyScore(candidate: string, query: string): number | null {
  if (!query) {
    return 0
  }
  const haystack = candidate.toLowerCase()
  let lastIndex = -1
  let score = 0
  for (const needleChar of query) {
    const nextIndex = haystack.indexOf(needleChar, lastIndex + 1)
    if (nextIndex === -1) {
      return null
    }
    const gap = nextIndex - lastIndex - 1
    score += gap === 0 ? 15 : Math.max(2, 12 - gap)
    lastIndex = nextIndex
  }
  if (haystack.startsWith(query)) {
    score += 20
  } else if (haystack.includes(query)) {
    score += 12
  }
  return score
}

type RankedItem = { item: CommandCenterItem; score: number }

function filterAndRank(items: CommandCenterItem[], query: string): RankedItem[] {
  return items
    .map(item => {
      const score = fuzzyScore(
        [item.title, item.subtitle, item.keywords].filter(Boolean).join(' '),
        query,
      )
      return score === null ? null : { item, score }
    })
    .filter((entry): entry is RankedItem => entry !== null)
    .sort((left, right) => right.score - left.score)
}

/**
 * Without a query sections keep their authored order. While searching, pinned sections stay
 * first and the rest follow their best match, so typing a Space's name leads with Spaces.
 */
export function rankCommandSections(
  sections: CommandCenterSection[],
  query: string,
): CommandCenterSection[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return sections.filter(section => section.items.length > 0)
  }
  const ranked = sections
    .map(section => ({ section, ranked: filterAndRank(section.items, normalizedQuery) }))
    .filter(entry => entry.ranked.length > 0)
  const bestScore = (entry: (typeof ranked)[number]): number => entry.ranked[0]?.score ?? 0
  return [
    ...ranked.filter(entry => entry.section.pinned),
    ...ranked
      .filter(entry => !entry.section.pinned)
      .sort((left, right) => bestScore(right) - bestScore(left)),
  ].map(entry => ({ ...entry.section, items: entry.ranked.map(item => item.item) }))
}
