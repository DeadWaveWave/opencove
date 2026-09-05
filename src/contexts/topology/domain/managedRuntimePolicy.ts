import type { RuntimeBuildIdentity } from '../../../shared/contracts/runtimeBuild'

export type ManagedRuntimeUpdateDecision =
  | 'reuse'
  | 'prepare'
  | 'client_update_required'
  | 'channel_conflict'
  | 'protocol_mismatch'
  | 'conflicting_build'

function compareVersions(left: string, right: string): number {
  const split = (value: string): [number[], string[]] => {
    const [core, ...suffix] = value.split('-')
    return [core.split('.').map(Number), suffix.join('-').split('.').filter(Boolean)]
  }
  const [a, ap] = split(left)
  const [b, bp] = split(right)
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i]
    }
  }
  if (ap.length === 0 || bp.length === 0) {
    return Number(bp.length > 0) - Number(ap.length > 0)
  }
  for (let i = 0; i < Math.max(ap.length, bp.length); i++) {
    if (ap[i] === bp[i]) {
      continue
    }
    if (ap[i] === undefined) {
      return -1
    }
    if (bp[i] === undefined) {
      return 1
    }
    const an = /^\d+$/.test(ap[i])
    const bn = /^\d+$/.test(bp[i])
    if (an && bn) {
      return Number(ap[i]) - Number(bp[i])
    }
    if (an !== bn) {
      return an ? -1 : 1
    }
    return ap[i] < bp[i] ? -1 : 1
  }
  return 0
}

export function decideManagedRuntimeUpdate(
  desired: RuntimeBuildIdentity,
  active: RuntimeBuildIdentity | null,
): ManagedRuntimeUpdateDecision {
  if (!active) {
    return 'prepare'
  }
  if (active.dataSchemaVersion > desired.dataSchemaVersion) {
    return 'client_update_required'
  }
  if (active.channel !== desired.channel) {
    return 'channel_conflict'
  }
  const order = compareVersions(active.appVersion, desired.appVersion)
  if (order > 0) {
    return 'client_update_required'
  }
  if (order < 0) {
    return 'prepare'
  }
  if (
    active.protocolVersion !== desired.protocolVersion ||
    active.ptyProtocolVersion !== desired.ptyProtocolVersion ||
    active.launchContractVersion !== desired.launchContractVersion
  ) {
    return 'protocol_mismatch'
  }
  if (active.buildId === desired.buildId) {
    return 'reuse'
  }
  return desired.channel === 'dev' ? 'prepare' : 'conflicting_build'
}
