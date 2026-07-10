export const PROJECT_ICON_IDS = [
  'code',
  'terminal',
  'database',
  'globe',
  'package',
  'bot',
  'briefcase',
  'book-open',
] as const

export type ProjectIconId = (typeof PROJECT_ICON_IDS)[number]

export function isProjectIconId(value: unknown): value is ProjectIconId {
  return PROJECT_ICON_IDS.includes(value as ProjectIconId)
}

export function normalizeProjectIconId(value: unknown): ProjectIconId | null {
  return isProjectIconId(value) ? value : null
}
