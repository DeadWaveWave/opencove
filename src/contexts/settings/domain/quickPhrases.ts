import { normalizeBoolean, normalizeTextValue } from './settingsNormalization'

export type QuickPhrase = {
  id: string
  title: string
  content: string
  enabled: boolean
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const MAX_QUICK_PHRASES = 100
const MAX_QUICK_PHRASE_TITLE_LENGTH = 80
const MAX_QUICK_PHRASE_CONTENT_LENGTH = 20_000

function normalizeQuickPhrase(value: unknown): QuickPhrase | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const id = normalizeTextValue(value.id)
  const title = normalizeTextValue(value.title).slice(0, MAX_QUICK_PHRASE_TITLE_LENGTH)
  const content = normalizeTextValue(value.content).slice(0, MAX_QUICK_PHRASE_CONTENT_LENGTH)
  const enabled = normalizeBoolean(value.enabled) ?? true

  if (id.length === 0 || title.length === 0 || content.length === 0) {
    return null
  }

  return { id, title, content, enabled }
}

export function normalizeQuickPhrases(value: unknown): QuickPhrase[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: QuickPhrase[] = []
  const seenIds = new Set<string>()

  for (const item of value) {
    const phrase = normalizeQuickPhrase(item)
    if (!phrase) {
      continue
    }

    if (seenIds.has(phrase.id)) {
      continue
    }

    seenIds.add(phrase.id)
    normalized.push(phrase)

    if (normalized.length >= MAX_QUICK_PHRASES) {
      break
    }
  }

  return normalized
}
