export { normalizeProvider } from '../../../shared/contracts/normalizeAgentProvider'

export { normalizeEnvPayload } from '../../../shared/contracts/normalizeTerminalEnv'

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') {
      continue
    }

    const trimmed = item.trim()
    if (trimmed.length === 0 || normalized.includes(trimmed)) {
      continue
    }

    normalized.push(trimmed)
  }

  return normalized
}
