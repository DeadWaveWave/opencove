import { AGENT_PROVIDERS, type AgentProvider } from './agentSettings.providers'
import { normalizeBoolean, normalizeTextValue } from './settingsNormalization'

export type AgentEnvRow = {
  id: string
  key: string
  value: string
  enabled: boolean
}

export type AgentEnvByProvider = Record<AgentProvider, AgentEnvRow[]>

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const MAX_ENV_ROWS_PER_PROVIDER = 100
const MAX_ENV_KEY_LENGTH = 120
const MAX_ENV_VALUE_LENGTH = 10_000
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

function normalizeAgentEnvRow(value: unknown): AgentEnvRow | null {
  if (!isPlainRecord(value)) {
    return null
  }

  const id = normalizeTextValue(value.id)
  const key = normalizeTextValue(value.key).slice(0, MAX_ENV_KEY_LENGTH)
  const envValue = normalizeTextValue(value.value).slice(0, MAX_ENV_VALUE_LENGTH)
  const enabled = normalizeBoolean(value.enabled) ?? true

  if (id.length === 0 || key.length === 0) {
    return null
  }

  if (!ENV_KEY_PATTERN.test(key)) {
    return null
  }

  return { id, key, value: envValue, enabled }
}

function normalizeAgentEnvRows(value: unknown): AgentEnvRow[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: AgentEnvRow[] = []
  const seenIds = new Set<string>()

  for (const item of value) {
    const row = normalizeAgentEnvRow(item)
    if (!row) {
      continue
    }

    if (seenIds.has(row.id)) {
      continue
    }

    seenIds.add(row.id)
    normalized.push(row)

    if (normalized.length >= MAX_ENV_ROWS_PER_PROVIDER) {
      break
    }
  }

  return normalized
}

export const DEFAULT_AGENT_ENV_BY_PROVIDER: AgentEnvByProvider = AGENT_PROVIDERS.reduce(
  (acc, provider) => {
    acc[provider] = []
    return acc
  },
  {} as AgentEnvByProvider,
)

export function normalizeAgentEnvByProvider(value: unknown): AgentEnvByProvider {
  if (!isPlainRecord(value)) {
    return { ...DEFAULT_AGENT_ENV_BY_PROVIDER }
  }

  return AGENT_PROVIDERS.reduce((acc, provider) => {
    acc[provider] = normalizeAgentEnvRows(value[provider])
    return acc
  }, {} as AgentEnvByProvider)
}

export function resolveEnabledEnvForAgent({
  rows,
  reservedPrefix = 'OPENCOVE_',
}: {
  rows: AgentEnvRow[]
  reservedPrefix?: string
}): Record<string, string> {
  const resolved: Record<string, string> = {}

  for (const row of rows) {
    if (!row.enabled) {
      continue
    }

    const key = row.key.trim()
    if (key.length === 0) {
      continue
    }

    if (reservedPrefix.length > 0 && key.startsWith(reservedPrefix)) {
      continue
    }

    resolved[key] = row.value
  }

  return resolved
}
