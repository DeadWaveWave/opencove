import type { ManagedClaudeFaultModel, FaultCase } from './managedClaudeFaultModel'

type Request = {
  node: ManagedClaudeFaultModel
  active: boolean
  kind: 'launch' | 'prepare'
  context: string
  identity: boolean
  approved: boolean
  legacyLiveRuntime: string | null
}
type Result = {
  ok?: boolean
  error?: { code: string }
  value?: {
    sessionId: string
    resumeSessionId: string
    managedClaudeBinding?: {
      nodeId: string
      activationId: string
      runtimeSessionId: string
      tuple: unknown
    }
    nodes?: { nodeId: string; sessionId: string; agent?: { resumeSessionId: string } }[]
  }
}

/** Permission is derived from the independent request contract, never from owner.admit. */
export class ManagedClaudeFaultOracle {
  private readonly current = new Map<string, string>()
  private readonly requests = new Map<string, Request>()
  constructor(private readonly models: readonly ManagedClaudeFaultModel[]) {}
  begin(name: string, nodeId: string, kind: 'launch' | 'prepare' = 'launch'): void {
    const node = this.models.find(value => value.nodeId === nodeId)!
    this.requests.set(name, {
      node,
      active: true,
      kind,
      context: JSON.stringify(node.context()),
      identity: false,
      approved: false,
      legacyLiveRuntime:
        !node.binding && node.nodeRuntime && node.alive.has(node.nodeRuntime)
          ? node.nodeRuntime
          : null,
    })
    if (kind === 'launch') {
      this.current.set(nodeId, name)
    }
  }
  end(name: string): void {
    const request = this.requests.get(name)!
    request.active = false
    if (this.current.get(request.node.nodeId) === name) {
      this.current.delete(request.node.nodeId)
    }
  }
  restart(): void {
    this.current.clear()
    for (const request of this.requests.values()) {
      request.active = false
    }
  }
  identity(name: string): void {
    this.requests.get(name)!.identity = true
  }
  approve(name: string, approved: boolean): void {
    const request = this.requests.get(name)!
    request.approved = approved
    if (request.kind === 'prepare' && !this.current.has(request.node.nodeId)) {
      this.current.set(request.node.nodeId, name)
    }
    request.node.effectAdmitted ||= this.permitted(name)
  }
  permitted(name: string): boolean {
    const request = this.requests.get(name)
    const current = request?.node.context()
    return Boolean(
      current?.kind === 'agent' &&
      current.provider === 'claude-code' &&
      current.directory === '/repo' &&
      current.route === 'null' &&
      JSON.stringify(request?.node.binding?.tuple ?? request?.node.tuple) ===
        JSON.stringify(request?.node.tuple) &&
      request &&
      request.active &&
      this.current.get(request.node.nodeId) === name &&
      request.identity &&
      request.approved &&
      !request.node.retired &&
      request.context === JSON.stringify(request.node.context()),
    )
  }
  effect(name: string): void {
    const request = this.requests.get(name)
    request?.node.verify(this.permitted(name), 'effect without independent admission permission')
  }
  outcome(
    name: string,
    value: unknown,
    config: FaultCase,
    reached: boolean,
    eventReached: boolean,
  ): void {
    const request = this.requests.get(name)!
    const node = request.node
    const result = value as Result
    const interfered = eventReached && ['delete', 'newer', 'restart'].includes(config.event)
    const prepared = result.value?.nodes?.find(preparedNode => preparedNode.nodeId === node.nodeId)
    if (name === 'primary' && interfered && !result.ok) {
      node.verify(
        [
          'agent.managed_launch_rejected',
          'agent.managed_launch_commit_failed',
          'agent.launch_failed',
          ...(config.fault === 'validation' && reached ? ['common.approved_path_required'] : []),
        ].includes(result.error?.code ?? ''),
        'outcome: unexpected concurrent failure kind',
      )
    }
    const sessionId = prepared?.sessionId ?? result.value?.sessionId
    if (name.startsWith('peer-') || name.startsWith('restart-')) {
      node.verify(result.ok === true, 'outcome: expected independent peer success')
    }
    if (name === 'primary' && !interfered) {
      const failure =
        reached &&
        !['none', 'finalization', 'cleanupKill'].includes(config.fault) &&
        !(config.fault === 'referenceRead' && config.initial !== 'owned')
      node.verify(result.ok === !failure, `outcome: expected ${failure ? 'failure' : 'success'}`)
      if (failure) {
        const code =
          config.fault === 'validation'
            ? 'common.approved_path_required'
            : config.fault === 'activationSuperseded' || config.fault === 'activationNodeGone'
              ? 'agent.managed_launch_rejected'
              : /^(activation|handoff)/.test(config.fault) || config.fault === 'confirmation'
                ? 'agent.managed_launch_commit_failed'
                : 'agent.launch_failed'
        node.verify(result.error?.code === code, `outcome: expected ${code}`)
      }
      if (!failure && result.ok) {
        node.verify(node.nodeRuntime === sessionId, 'outcome: wrong runtime association')
        node.verify(node.alive.has(sessionId ?? ''), 'outcome: returned runtime is not alive')
      }
    }
    if (result.ok && prepared) {
      node.verify(
        prepared.agent?.resumeSessionId === node.tuple.resumeSessionId,
        'outcome: wrong prepared tuple',
      )
      node.verify(
        (node.nodeRuntime === prepared.sessionId && node.alive.has(prepared.sessionId)) ||
          (name === 'prepare' && request.legacyLiveRuntime === prepared.sessionId),
        'outcome: wrong prepared runtime',
      )
    }
    if (result.ok && result.value && !result.value.nodes) {
      const receipt = result.value.managedClaudeBinding
      const commit = node.committed.get(receipt?.activationId ?? '')
      node.verify(
        receipt?.nodeId === node.nodeId &&
          commit?.runtimeSessionId === result.value.sessionId &&
          JSON.stringify(commit?.tuple) === JSON.stringify(receipt?.tuple),
        'outcome: unattributable receipt',
      )
      node.verify(
        result.value.resumeSessionId === node.tuple.resumeSessionId,
        'outcome: wrong effective tuple',
      )
      node.verify(
        JSON.stringify(result.value.managedClaudeBinding?.tuple) === JSON.stringify(node.tuple),
        'outcome: wrong receipt tuple',
      )
      node.verify(
        result.value.managedClaudeBinding?.runtimeSessionId === result.value.sessionId,
        'outcome: wrong receipt runtime',
      )
      node.verify(
        node.created.get(result.value.sessionId) === name,
        'outcome: foreign command runtime',
      )
    }
    if (node.binding) {
      node.verify(
        JSON.stringify(node.binding.tuple) === JSON.stringify(node.tuple),
        'outcome: wrong durable tuple',
      )
    }
  }
}
