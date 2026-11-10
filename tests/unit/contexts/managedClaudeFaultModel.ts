import { expect } from 'vitest'
import type { ManagedClaudeBindingObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../src/shared/contracts/managedClaudeResumeBinding'
import { sameManagedResumeBinding } from '../../../src/shared/contracts/managedClaudeResumeBinding'

export const steps = [
  'identity',
  'validation',
  'handoff',
  'handoffConfirmation',
  'admissionKill',
  'spawn',
  'registration',
  'activation',
  'confirmation',
  'finalization',
  'referenceRead',
  'cleanupKill',
] as const
export type EffectStep = (typeof steps)[number]
export const fallbackSteps = [
  'shellProfile',
  'shellActivity',
  'shellSpawn',
  'shellRegistration',
  'shellReturn',
  'shellPersistence',
  'referenceRead',
  'cleanupKill',
] as const
export type FallbackStep = (typeof fallbackSteps)[number]
export type Edge = `${EffectStep | FallbackStep}:${'before' | 'after'}`
export type ConcurrentEvent =
  | 'none'
  | 'delete'
  | 'newer'
  | 'prepare'
  | 'restart'
  | 'peerLaunch'
  | 'peerRecovery'
  | 'peerDelete'
export const faults = [
  'none',
  'identity',
  'validation',
  'admissionKill',
  'spawn',
  'registration',
  'onStarted',
  'handoffFailure',
  'handoffUnknown',
  'handoffUnknownCommitted',
  'handoffConfirmation',
  'activationFailure',
  'activationUnknown',
  'activationUnknownCommitted',
  'activationSuperseded',
  'activationNodeGone',
  'confirmation',
  'finalization',
  'referenceRead',
  'cleanupKill',
] as const
export type Fault = (typeof faults)[number]
export interface FaultCase {
  fault: Fault
  event: ConcurrentEvent
  edge: Edge
  initial: 'owned' | 'fallback' | 'adoption'
  outageRetries?: number
}

/** Independent oracle: physical processes, durable references and successful kills. */
export class ManagedClaudeFaultModel {
  readonly alive = new Map<string, string>()
  readonly killed = new Map<string, number>()
  readonly killAttempts = new Map<string, number>()
  readonly technical = new Map<string, string>()
  readonly trace: string[] = []
  readonly violations: string[] = []
  readonly tuple: { resumeSessionId: string; resumeSessionIdVerified: boolean }
  readonly committed = new Map<string, { runtimeSessionId: string | null; tuple: unknown }>()
  readonly created = new Map<string, string>()
  readonly runtimeKinds = new Map<string, 'agent' | 'shell'>()
  readonly awaitingPersistence = new Set<string>()
  readonly original: string
  readonly initiallyAlive: boolean
  binding: ManagedClaudeBindingObservation | null
  nodeRuntime: string | null
  present = true
  retired = false
  revision = 1
  epoch = 0
  effectAdmitted = false
  changedByOther = false
  blockedRead = false
  workerBinding: { endpointId: string; mountId: string | null } | null = null
  private nextRuntime = 0

  constructor(
    readonly initial: FaultCase['initial'],
    readonly nodeId = 'agent',
    cold = false,
  ) {
    this.original = nodeId === 'agent' ? 'original' : `${nodeId}-original`
    this.tuple = { resumeSessionId: this.original, resumeSessionIdVerified: true }
    this.nodeRuntime = this.original
    this.initiallyAlive = !cold
    if (!cold) {
      this.alive.set(this.original, nodeId)
    }
    this.binding =
      initial === 'adoption'
        ? null
        : {
            nodeId: this.nodeId,
            activationId: 'initial',
            runtimeSessionId: initial === 'owned' ? this.original : null,
            tuple: this.tuple,
            nodeSeen: true,
            bindingRevision: 1,
            observedRevision: 1,
          }
  }

  referenced(id: string): boolean {
    return this.binding?.runtimeSessionId === id || (this.present && this.nodeRuntime === id)
  }

  context() {
    return this.present
      ? {
          kind: 'agent',
          provider: 'claude-code',
          directory: '/repo',
          route: JSON.stringify(this.workerBinding),
        }
      : null
  }

  observation(nodeId: string) {
    if (this.blockedRead) {
      throw new Error('storage unavailable at clean boundary')
    }
    return {
      nodeId,
      retired: this.retired,
      binding: this.binding,
      nodeRuntimeSessionId: this.nodeRuntime,
      context: this.context(),
    }
  }

  appState() {
    return {
      formatVersion: 1,
      activeWorkspaceId: 'workspace',
      settings: {},
      workspaces: [
        {
          id: 'workspace',
          name: 'Workspace',
          path: '/repo',
          spaces: [],
          nodes: this.present
            ? [
                {
                  id: this.nodeId,
                  kind: 'agent',
                  sessionId: this.nodeRuntime ?? '',
                  title: 'Agent',
                  width: 600,
                  height: 400,
                  status: 'standby',
                  executionDirectory: '/repo',
                  agent: {
                    provider: 'claude-code',
                    prompt: 'fixture',
                    executionDirectory: '/repo',
                    ...(this.binding?.tuple ?? this.tuple),
                  },
                },
              ]
            : [],
        },
      ],
    }
  }

  activate(input: ActivateManagedClaudeRuntimeInput) {
    if (this.retired) {
      return { status: 'nodeGone' as const }
    }
    if (
      input.expected &&
      (input.expected.activationId !== (this.binding?.activationId ?? null) ||
        !sameManagedResumeBinding(
          input.expected.tuple,
          this.binding?.tuple ?? { resumeSessionId: null, resumeSessionIdVerified: false },
        ))
    ) {
      return { status: 'superseded' as const }
    }
    if (input.runtimeSessionId) {
      this.verify(
        this.alive.get(input.runtimeSessionId) === input.nodeId,
        'activation of dead/foreign runtime',
      )
    }
    this.revision++
    this.binding = {
      nodeId: input.nodeId,
      activationId: input.activationId,
      runtimeSessionId: input.runtimeSessionId,
      tuple: { ...input.tuple },
      nodeSeen: this.present,
      bindingRevision: this.revision,
      observedRevision: this.revision,
    }
    this.nodeRuntime = input.runtimeSessionId
    this.committed.set(input.activationId, {
      runtimeSessionId: input.runtimeSessionId,
      tuple: { ...input.tuple },
    })
    return { status: 'committed' as const, revision: this.revision }
  }

  spawn(actor: string, kind: 'agent' | 'shell' = 'agent'): string {
    const id = `${this.nodeId}-runtime-${++this.nextRuntime}`
    this.alive.set(id, this.nodeId)
    this.created.set(id, actor)
    this.technical.set(id, actor)
    this.runtimeKinds.set(id, kind)
    return id
  }

  kill(id: string): void {
    this.verify(!this.referenced(id), `${id}: referenced kill`)
    this.verify(!this.killed.has(id), `${id}: duplicate successful kill request`)
    if (this.alive.delete(id)) {
      this.killed.set(id, (this.killed.get(id) ?? 0) + 1)
      this.verify(this.killed.get(id) === 1, `${id}: duplicate successful kill`)
    }
  }

  remove(): string[] {
    const ids = [
      ...new Set(
        [this.nodeRuntime, this.binding?.runtimeSessionId].filter((id): id is string => !!id),
      ),
    ]
    this.changedByOther = true
    this.present = false
    this.retired = true
    this.nodeRuntime = null
    this.binding = null
    return ids
  }

  stop(): void {
    // Explicit Worker teardown owns all its processes; durable IDs are recovered on next boot.
    this.epoch++
    this.changedByOther = true
    this.alive.clear()
    this.technical.clear()
  }

  check(cleanupIds: readonly string[], quiescent = false): void {
    this.verify(new Set(cleanupIds).size === cleanupIds.length, 'duplicate cleanup owner')
    if (!this.effectAdmitted && !this.changedByOther) {
      this.verify(this.nodeRuntime === this.original, 'pre-admission node detached')
      this.verify(
        (this.binding?.runtimeSessionId ?? null) ===
          (this.initial === 'owned' ? this.original : null),
        'pre-admission ledger detached',
      )
      if (this.initiallyAlive) {
        this.verify(this.alive.has(this.original), 'pre-admission healthy runtime killed')
      }
    }
    for (const [id, nodeId] of this.alive) {
      if (!this.referenced(id)) {
        this.verify(
          cleanupIds.includes(id) || (!quiescent && this.technical.has(id)),
          `${id}: missing cleanup`,
        )
      }
      this.verify(nodeId === this.nodeId, `${id}: foreign runtime`)
    }
    if (quiescent) {
      const ownIds = cleanupIds.filter(id => id === this.original || this.created.has(id))
      this.verify(
        ownIds.every(
          id => this.awaitingPersistence.has(id) && this.present && !this.referenced(id),
        ),
        'cleanup did not converge after recovery of its ports',
      )
      this.verify(this.technical.size === 0, 'technical runtime custody was not handed off')
      for (const id of [this.binding?.runtimeSessionId, this.present ? this.nodeRuntime : null]) {
        if (id) {
          this.verify(this.alive.get(id) === this.nodeId, `${id}: dead/foreign reference`)
        }
      }
    }
  }

  assertValid(): void {
    expect(this.violations, this.trace.join('\n')).toEqual([])
  }

  verify(valid: boolean, failure: string): void {
    if (!valid) {
      this.violations.push(`${failure} at ${this.trace.at(-1) ?? 'initial'}`)
    }
  }
}
