// Frozen wire-format values written by shipped OpenCove builds.
export const LEGACY_MANAGED_CLAUDE_HOOK_STATUS_MESSAGE = 'OpenCove agent status'
export const LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION = 'OpenCove managed agent status hooks'

export interface LegacyHookCleanupResult<T> {
  readonly content: T
  readonly removedCount: number
}

type JsonRecord = Record<string, unknown>
type ManagedGroupPredicate = (value: unknown) => boolean

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cleanHookGroups(
  config: unknown,
  isManagedGroup: ManagedGroupPredicate,
): LegacyHookCleanupResult<unknown> {
  if (!isRecord(config) || !isRecord(config.hooks)) {
    return { content: config, removedCount: 0 }
  }

  let removedCount = 0
  const hooks: JsonRecord = {}
  for (const [eventName, groups] of Object.entries(config.hooks)) {
    if (!Array.isArray(groups)) {
      hooks[eventName] = groups
      continue
    }

    const retained = groups.filter(group => {
      if (!isManagedGroup(group)) {
        return true
      }
      removedCount += 1
      return false
    })
    if (retained.length > 0) {
      hooks[eventName] = retained
    }
  }

  if (removedCount === 0) {
    return { content: config, removedCount: 0 }
  }

  const content: JsonRecord = { ...config }
  if (Object.keys(hooks).length > 0) {
    content.hooks = hooks
  } else {
    delete content.hooks
  }
  return { content, removedCount }
}

function isLegacyClaudeHookGroup(value: unknown): boolean {
  return (
    isRecord(value) &&
    Array.isArray(value.hooks) &&
    value.hooks.some(
      hook => isRecord(hook) && hook.statusMessage === LEGACY_MANAGED_CLAUDE_HOOK_STATUS_MESSAGE,
    )
  )
}

export function cleanLegacyClaudeSettings(settings: unknown): LegacyHookCleanupResult<unknown> {
  return cleanHookGroups(settings, isLegacyClaudeHookGroup)
}

export function isLegacyOpenCoveCodexHooksFile(parsed: unknown): boolean {
  return isRecord(parsed) && parsed.description === LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION
}

function isLegacyCodexHookGroup(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }
  if (value.description === LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION) {
    return true
  }
  return (
    Array.isArray(value.hooks) &&
    value.hooks.some(
      hook => isRecord(hook) && hook.description === LEGACY_MANAGED_CODEX_HOOK_DESCRIPTION,
    )
  )
}

export function cleanLegacyCodexHooksFile(parsed: unknown): LegacyHookCleanupResult<unknown> {
  return cleanHookGroups(parsed, isLegacyCodexHookGroup)
}

const CODEX_STATE_HEADER_PATTERN = /^\s*\[hooks\.state\."((?:[^"\\]|\\.)*)"\]\s*(?:#.*)?$/u
const LEGACY_CODEX_HOOK_REFERENCE_PATTERN = /(?:^|\/)\.codex\/hooks\.json:[A-Za-z0-9_-]+:\d+:\d+$/u
const TOML_TABLE_HEADER_PATTERN = /^\s*(?:\[\[[^\]\r\n]+\]\]|\[[^\]\r\n]+\])\s*(?:#.*)?$/u
const TOML_TABLE_LIKE_PATTERN = /^\s*\[/u

function isLegacyCodexTrustTable(line: string): boolean {
  const match = CODEX_STATE_HEADER_PATTERN.exec(line)
  if (!match?.[1]) {
    return false
  }

  let key = match[1]
  try {
    key = JSON.parse(`"${key}"`) as string
  } catch {
    return false
  }
  return LEGACY_CODEX_HOOK_REFERENCE_PATTERN.test(key.replaceAll('\\', '/'))
}

function linesWithEndings(content: string): string[] {
  return content.match(/[^\r\n]*(?:\r\n|\n|\r|$)/gu)?.filter(Boolean) ?? []
}

function withoutLineEnding(line: string): string {
  return line.replace(/[\r\n]+$/u, '')
}

export function cleanLegacyCodexConfigToml(toml: string): LegacyHookCleanupResult<string> {
  const lines = linesWithEndings(toml)
  const output: string[] = []
  let removedCount = 0
  let removingLegacyTable = false

  for (const line of lines) {
    const normalized = withoutLineEnding(line)
    const isTableHeader = TOML_TABLE_HEADER_PATTERN.test(normalized)
    if (!isTableHeader && removingLegacyTable && TOML_TABLE_LIKE_PATTERN.test(normalized)) {
      return { content: toml, removedCount: 0 }
    }

    if (isTableHeader) {
      removingLegacyTable = isLegacyCodexTrustTable(normalized)
      if (removingLegacyTable) {
        removedCount += 1
      } else {
        output.push(line)
      }
      continue
    }

    if (!removingLegacyTable) {
      output.push(line)
    }
  }

  return removedCount === 0
    ? { content: toml, removedCount: 0 }
    : { content: output.join(''), removedCount }
}
