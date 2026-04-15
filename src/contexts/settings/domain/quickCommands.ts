import { normalizeBoolean, normalizeTextValue } from './settingsNormalization'

export type QuickCommand =
  | {
      id: string
      title: string
      kind: 'terminal'
      command: string
      enabled: boolean
      pinned: boolean
    }
  | {
      id: string
      title: string
      kind: 'url'
      url: string
      enabled: boolean
      pinned: boolean
    }

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const MAX_QUICK_COMMANDS = 50
const MAX_QUICK_COMMAND_TITLE_LENGTH = 80
const MAX_QUICK_COMMAND_VALUE_LENGTH = 10_000

function normalizeQuickCommand(value: unknown): QuickCommand | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const id = normalizeTextValue(value.id)
  const title = normalizeTextValue(value.title).slice(0, MAX_QUICK_COMMAND_TITLE_LENGTH)
  const enabled = normalizeBoolean(value.enabled) ?? true
  const pinned = normalizeBoolean(value.pinned) ?? false

  if (id.length === 0 || title.length === 0) {
    return null
  }

  if (value.kind === 'terminal') {
    const command = normalizeTextValue(value.command).slice(0, MAX_QUICK_COMMAND_VALUE_LENGTH)
    if (command.length === 0) {
      return null
    }

    return {
      id,
      title,
      kind: 'terminal',
      command,
      enabled,
      pinned,
    }
  }

  if (value.kind === 'url') {
    const url = normalizeTextValue(value.url).slice(0, MAX_QUICK_COMMAND_VALUE_LENGTH)
    if (url.length === 0) {
      return null
    }

    return {
      id,
      title,
      kind: 'url',
      url,
      enabled,
      pinned,
    }
  }

  return null
}

export function normalizeQuickCommands(value: unknown): QuickCommand[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: QuickCommand[] = []
  const seenIds = new Set<string>()

  for (const item of value) {
    const command = normalizeQuickCommand(item)
    if (!command) {
      continue
    }

    if (seenIds.has(command.id)) {
      continue
    }

    seenIds.add(command.id)
    normalized.push(command)

    if (normalized.length >= MAX_QUICK_COMMANDS) {
      break
    }
  }

  return normalized
}
