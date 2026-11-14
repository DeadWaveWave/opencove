import {
  claudePromptId,
  type PromptSubmissionEvidence,
} from '../../../shared/runtime/agentHook/claudePromptEvidence'
import type { AgentRunObservation } from '../domain/agentRunState'

type Pair = { providerSessionId: string; providerTurnId: string }
type Binding = Pair & { turnId: string; emittedAtMs?: number; superseded?: boolean }
function pair(value?: PromptSubmissionEvidence): Pair | undefined {
  const providerSessionId = claudePromptId(value?.providerSessionId)
  const providerTurnId = claudePromptId(value?.providerTurnId)
  return providerSessionId && providerTurnId ? { providerSessionId, providerTurnId } : undefined
}
function key(value: Pair): string {
  return JSON.stringify([value.providerSessionId, value.providerTurnId])
}
export function sameCodexPair(a?: PromptSubmissionEvidence, b?: PromptSubmissionEvidence): boolean {
  const left = pair(a),
    right = pair(b)
  return !!left && !!right && key(left) === key(right)
}
function conflicts(a?: PromptSubmissionEvidence, b?: PromptSubmissionEvidence): boolean {
  return !!(
    (a?.providerSessionId && b?.providerSessionId && a.providerSessionId !== b.providerSessionId) ||
    (a?.providerTurnId && b?.providerTurnId && a.providerTurnId !== b.providerTurnId)
  )
}

/** Private runtime identity index, owned by AgentTurnHistory; never archived or published. */
export class CodexTurnIdentity {
  private readonly bindings = new Map<string, Binding>()
  private latest?: Binding
  endedTurnIds(): string[] {
    return [...this.bindings.values()].filter(b => b.superseded !== undefined).map(b => b.turnId)
  }
  identity(): PromptSubmissionEvidence | undefined {
    return (
      this.latest && {
        providerSessionId: this.latest.providerSessionId,
        providerTurnId: this.latest.providerTurnId,
      }
    )
  }
  lookup(evidence?: PromptSubmissionEvidence): string | undefined {
    const value = pair(evidence)
    return value ? this.bindings.get(key(value))?.turnId : undefined
  }
  submissionTurnId(
    evidence?: PromptSubmissionEvidence,
    fallback?: string,
    active?: PromptSubmissionEvidence,
  ): string | undefined {
    if (pair(evidence)) {
      return this.lookup(evidence)
    }
    return conflicts(active ?? this.latest, evidence) ? undefined : fallback
  }
  bind(evidence: PromptSubmissionEvidence | undefined, turnId: string, emittedAtMs?: number): void {
    const value = pair(evidence)
    if (!value) {
      return
    }
    const binding = { ...value, turnId, emittedAtMs }
    this.bindings.set(key(value), binding)
    this.latest = binding
    // Identity tombstones outlive the smaller message cache, but remain bounded per incarnation.
    while (this.bindings.size > 1024) {
      this.bindings.delete(this.bindings.keys().next().value!)
    }
  }
  end(evidence: PromptSubmissionEvidence | undefined, superseded: boolean): void {
    const value = pair(evidence)
    const binding = value && this.bindings.get(key(value))
    if (binding) {
      binding.superseded = superseded
    }
  }
  supersedes(
    observation: AgentRunObservation | null,
    evidence?: PromptSubmissionEvidence,
    active?: PromptSubmissionEvidence & { emittedAtMs?: number },
  ): boolean {
    return !!(
      observation?.source === 'codex_hook' &&
      observation.hookEventName === 'UserPromptSubmit' &&
      observation.boundary?.kind === 'start' &&
      observation.boundary.evidence === 'prompt_submit' &&
      pair(active) &&
      pair(evidence) &&
      !sameCodexPair(active, evidence) &&
      !this.lookup(evidence) &&
      active?.emittedAtMs !== undefined &&
      observation.emittedAtMs !== undefined &&
      observation.emittedAtMs > active.emittedAtMs
    )
  }
  rejects(
    observation: AgentRunObservation,
    evidence?: PromptSubmissionEvidence,
    active?: PromptSubmissionEvidence & { emittedAtMs?: number },
  ): boolean {
    if (observation.source !== 'codex_hook') {
      return false
    }
    if (observation.hookEventName === 'Stop' || observation.hookEventName === 'notify') {
      // Ended bindings retain correlation, not active authority. A lost submit must not
      // prevent an otherwise trustworthy uncorrelated Stop from restoring readiness.
      if (conflicts(active, evidence)) {
        return true
      }
      const value = pair(evidence)
      return !!(value && this.bindings.get(key(value))?.superseded)
    }
    if (observation.hookEventName !== 'UserPromptSubmit') {
      return false
    }
    if (sameCodexPair(active, evidence)) {
      return false
    }
    if (this.lookup(evidence)) {
      return true
    }
    const value = pair(evidence)
    if (!value) {
      return false
    } // State evidence without a turn id is not correlated content.
    if (this.latest) {
      const switching = value.providerSessionId !== this.latest.providerSessionId
      if (
        switching &&
        (this.latest.emittedAtMs === undefined || observation.emittedAtMs === undefined)
      ) {
        return true
      }
      const retiredSession =
        value.providerSessionId !== this.latest.providerSessionId &&
        [...this.bindings.values()].some(b => b.providerSessionId === value.providerSessionId)
      if (retiredSession) {
        return true
      }
      if (
        this.latest.emittedAtMs !== undefined &&
        observation.emittedAtMs !== undefined &&
        observation.emittedAtMs <= this.latest.emittedAtMs
      ) {
        return true
      }
    }
    return !!(pair(active) && !this.supersedes(observation, evidence, active))
  }
}
