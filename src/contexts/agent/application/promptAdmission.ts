import type { RunStateFence, PromptDeliveryPorts } from './ports/PromptDeliveryPorts'
export type PromptRefusal = {
  code:
    | 'agent.not_running'
    | 'agent.prompt_unsupported'
    | 'agent.state_unknown'
    | 'agent.blocked'
    | 'agent.busy'
  reason: string
}
export function promptAdmission(
  fence: RunStateFence | null,
  capability: PromptDeliveryPorts['capability'],
): PromptRefusal | null {
  if (!fence || fence.snapshot.state === 'exited') {
    return { code: 'agent.not_running', reason: 'not_running' }
  }
  if (fence.remote) {
    return { code: 'agent.prompt_unsupported', reason: 'remote_unsupported' }
  }
  if (!capability(fence.snapshot.provider)?.supported) {
    return { code: 'agent.prompt_unsupported', reason: 'provider_unsupported' }
  }
  const s = fence.snapshot
  if (s.state === 'waiting') {
    return { code: 'agent.blocked', reason: 'waiting' }
  }
  if (s.state === 'working') {
    return { code: 'agent.busy', reason: 'working' }
  }
  if (fence.hookInstallState !== undefined && fence.hookInstallState !== 'installed') {
    return { code: 'agent.state_unknown', reason: 'observation_degraded' }
  }
  if (s.state === 'unknown' && s.source === null && !Object.keys(fence.watermarks).length) {
    return { code: 'agent.state_unknown', reason: 'readiness_unobserved' }
  }
  if (s.quality === 'degraded') {
    return { code: 'agent.state_unknown', reason: 'observation_degraded' }
  }
  if (
    s.state !== 'idle' ||
    s.source !== 'claude_hook' ||
    s.turn ||
    !['Stop', 'StopFailure'].includes(fence.selectedHookEventName ?? '')
  ) {
    return { code: 'agent.state_unknown', reason: 'readiness_unobserved' }
  }
  return null
}
export function samePromptEntry(a: RunStateFence, b: RunStateFence | null): b is RunStateFence {
  return (
    !!b &&
    a.snapshot.sessionId === b.snapshot.sessionId &&
    a.epoch === b.epoch &&
    a.incarnation === b.incarnation &&
    a.bindingGeneration === b.bindingGeneration &&
    a.snapshot.nodeId === b.snapshot.nodeId
  )
}
