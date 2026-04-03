import type { WebsiteWindowPolicy } from '../../../shared/contracts/dto'

export const DEFAULT_WEBSITE_WINDOW_POLICY: WebsiteWindowPolicy = {
  enabled: false,
  maxActiveCount: 1,
  discardAfterMinutes: 20,
  keepAliveHosts: [],
}

export function normalizeWebsiteWindowPolicy(input: WebsiteWindowPolicy): WebsiteWindowPolicy {
  const enabled = input.enabled === true
  const maxActiveCount =
    typeof input.maxActiveCount === 'number' && Number.isFinite(input.maxActiveCount)
      ? Math.max(1, Math.min(6, Math.round(input.maxActiveCount)))
      : DEFAULT_WEBSITE_WINDOW_POLICY.maxActiveCount
  const discardAfterMinutes =
    typeof input.discardAfterMinutes === 'number' && Number.isFinite(input.discardAfterMinutes)
      ? Math.max(1, Math.min(240, Math.round(input.discardAfterMinutes)))
      : DEFAULT_WEBSITE_WINDOW_POLICY.discardAfterMinutes
  const keepAliveHosts = Array.isArray(input.keepAliveHosts)
    ? [
        ...new Set(
          input.keepAliveHosts
            .map(item => (typeof item === 'string' ? item.trim() : ''))
            .filter(Boolean),
        ),
      ].slice(0, 64)
    : []

  return {
    enabled,
    maxActiveCount,
    discardAfterMinutes,
    keepAliveHosts,
  }
}
