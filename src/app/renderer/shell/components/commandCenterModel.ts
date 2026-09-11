import type React from 'react'
import type { LabelColor } from '@shared/types/labelColor'

export type CommandCenterItem = {
  id: string
  title: string
  keywords?: string
  icon: React.JSX.Element
  labelColor?: LabelColor | null
  remoteLabel?: string
  isCurrent?: boolean
  showCurrentMarker?: boolean
  onSelect: () => void
}

export type CommandCenterSection = {
  id: string
  label: string
  items: CommandCenterItem[]
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

function filterAndRank(items: CommandCenterItem[], query: string): CommandCenterItem[] {
  const normalizedQuery = normalizeQuery(query)
  if (!normalizedQuery) {
    return items
  }
  return items
    .map(item => {
      const score = fuzzyScore(
        [item.title, item.keywords].filter(Boolean).join(' '),
        normalizedQuery,
      )
      return score === null ? null : { item, score }
    })
    .filter((entry): entry is { item: CommandCenterItem; score: number } => entry !== null)
    .sort((left, right) => right.score - left.score)
    .map(entry => entry.item)
}

export function rankCommandSections(
  sections: CommandCenterSection[],
  query: string,
): CommandCenterSection[] {
  return sections
    .map(section => ({ ...section, items: filterAndRank(section.items, query) }))
    .filter(section => section.items.length > 0)
}
