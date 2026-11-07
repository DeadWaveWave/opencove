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
  if (fence.launchKind !== 'managed') {
    return { code: 'agent.prompt_unsupported', reason: 'terminal_agent_unsupported' }
  }
  if (!capability(fence.snapshot.provider)?.supported) {
    return { code: 'agent.prompt_unsupported', reason: 'provider_unsupported' }
  }
  if (fence.hookCoverage === 'unverified_executable') {
    return { code: 'agent.prompt_unsupported', reason: 'executable_override_unverified' }
  }
  const s = fence.snapshot
  if (s.provider === 'codex') {
    const install = fence.hookInstallState
    const reason =
      install && install !== 'installed'
        ? `codex_hooks_${install}`
        : fence.hookCoverage === 'notify_only'
          ? 'codex_hooks_notify_only'
          : fence.hookCoverage !== 'lifecycle'
            ? 'codex_hooks_missing'
            : null
    if (reason) {
      return { code: 'agent.prompt_unsupported', reason }
    }
  }
  if (s.state === 'waiting') {
    return { code: 'agent.blocked', reason: 'waiting' }
  }
  if (s.state === 'working') {
    return { code: 'agent.busy', reason: 'working' }
  }
  if (fence.hookInstallState !== undefined && fence.hookInstallState !== 'installed') {
    return { code: 'agent.state_unknown', reason: 'observation_degraded' }
  }
  if (s.provider === 'claude-code' && fence.hookCoverage !== 'lifecycle') {
    return { code: 'agent.prompt_unsupported', reason: 'claude_hooks_missing' }
  }
  if (s.provider === 'codex' && s.source === 'session_file') {
    return { code: 'agent.prompt_unsupported', reason: 'codex_lifecycle_observation_missing' }
  }
  if (s.state === 'unknown' && s.source === null && !Object.keys(fence.watermarks).length) {
    return { code: 'agent.state_unknown', reason: 'readiness_unobserved' }
  }
  if (s.quality === 'degraded') {
    return { code: 'agent.state_unknown', reason: 'observation_degraded' }
  }
  if (
    s.state !== 'idle' ||
    s.source !== promptHookSource(s.provider) ||
    s.turn ||
    fence.lastTurnEnd?.source !== s.source ||
    !(s.provider === 'codex' ? ['Stop'] : ['Stop', 'StopFailure']).includes(
      fence.lastTurnEnd?.hookEventName ?? '',
    )
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

/** Provider lifecycle source, shared by admission and submission receipt matching. */
export function promptHookSource(
  provider: RunStateFence['snapshot']['provider'],
): 'codex_hook' | 'claude_hook' {
  return provider === 'codex' ? 'codex_hook' : 'claude_hook'
}
