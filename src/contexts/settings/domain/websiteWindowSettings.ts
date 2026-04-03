import type { WebsiteWindowPolicy } from '../../../shared/contracts/dto'
import {
  isRecord,
  normalizeBoolean,
  normalizeIntegerInRange,
  normalizeUniqueStringArray,
} from './settingsNormalization'

export const DEFAULT_WEBSITE_WINDOW_POLICY: WebsiteWindowPolicy = {
  enabled: false,
  maxActiveCount: 1,
  discardAfterMinutes: 20,
  keepAliveHosts: [],
}

export function normalizeWebsiteWindowPolicy(
  value: unknown,
  fallback: WebsiteWindowPolicy = DEFAULT_WEBSITE_WINDOW_POLICY,
): WebsiteWindowPolicy {
  const input = isRecord(value) ? value : {}

  return {
    enabled: normalizeBoolean(input.enabled) ?? fallback.enabled,
    maxActiveCount: normalizeIntegerInRange(input.maxActiveCount, fallback.maxActiveCount, 1, 6),
    discardAfterMinutes: normalizeIntegerInRange(
      input.discardAfterMinutes,
      fallback.discardAfterMinutes,
      1,
      240,
    ),
    keepAliveHosts: normalizeUniqueStringArray(input.keepAliveHosts).slice(0, 64),
  }
}
