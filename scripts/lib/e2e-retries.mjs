/**
 * The one retry rule for every Playwright config: the integer from OPENCOVE_E2E_RETRIES when it
 * is 0 or more, otherwise 0. Required continuity gates never hide deterministic failures behind
 * retries (DEVELOPMENT.md), so there is no CI-dependent default.
 */
export function resolveE2ERetries(rawValue) {
  const normalized = typeof rawValue === 'string' ? rawValue.trim() : ''
  if (normalized) {
    const parsed = Number(normalized)
    if (Number.isInteger(parsed) && parsed >= 0) {
      return parsed
    }
  }

  return 0
}
