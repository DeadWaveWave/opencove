import {
  APP_UPDATE_CHANNELS,
  APP_UPDATE_POLICIES,
  type AppUpdateChannel,
  type AppUpdatePolicy,
} from '../../../shared/contracts/dto'

export function isValidUpdatePolicy(value: unknown): value is AppUpdatePolicy {
  return typeof value === 'string' && APP_UPDATE_POLICIES.includes(value as AppUpdatePolicy)
}

export function isValidUpdateChannel(value: unknown): value is AppUpdateChannel {
  return typeof value === 'string' && APP_UPDATE_CHANNELS.includes(value as AppUpdateChannel)
}

export function normalizeUpdatePolicyForChannel(
  policy: AppUpdatePolicy,
  channel: AppUpdateChannel,
): AppUpdatePolicy {
  // Nightly builds are intentionally more volatile: don't auto-install them.
  if (channel === 'nightly' && policy === 'auto') {
    return 'prompt'
  }

  return policy
}
