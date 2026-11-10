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
export type Edge = `${EffectStep}:${'before' | 'after'}`
export type ConcurrentEvent = 'none' | 'delete' | 'newer' | 'prepare' | 'restart'
export const faults = [
  'none',
  'identity',
  'validation',
  'admissionKill',
  'spawn',
  'registration',
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
}

/** Independent oracle: physical processes, durable references and successful kills. */
export class ManagedClaudeFaultModel {
  readonly alive = new Map<string, string>()
  readonly killed = new Map<string, number>()
  readonly killAttempts = new Map<string, number>()
  readonly technical = new Map<string, string>()
  readonly trace: string[] = []
  readonly violations: string[] = []
  readonly tuple = { resumeSessionId: 'original', resumeSessionIdVerified: true }
  binding: ManagedClaudeBindingObservation | null
  nodeRuntime: string | null = 'original'
  present = true
  retired = false
  revision = 1
  epoch = 0
  effectAdmitted = false
  changedByOther = false
  blockedRead = false
  private nextRuntime = 0

  constructor(readonly initial: FaultCase['initial']) {
    this.alive.set('original', 'agent')
    this.binding =
      initial === 'adoption'
        ? null
        : {
            nodeId: 'agent',
            activationId: 'initial',
            runtimeSessionId: initial === 'owned' ? 'original' : null,
            tuple: this.tuple,
            nodeSeen: true,
            bindingRevision: 1,
            observedRevision: 1,
          }
  }

  referenced(id: string): boolean {
    return this.binding?.runtimeSessionId === id || (this.present && this.nodeRuntime === id)
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
      context: this.present
        ? { kind: 'agent', provider: 'claude-code', directory: '/repo', route: 'null' }
        : null,
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
                  id: 'agent',
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
    return { status: 'committed' as const, revision: this.revision }
  }

  spawn(actor: string): string {
    const id = `runtime-${++this.nextRuntime}`
    this.alive.set(id, 'agent')
    this.technical.set(id, actor)
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
      this.verify(this.nodeRuntime === 'original', 'pre-admission node detached')
      this.verify(
        (this.binding?.runtimeSessionId ?? null) === (this.initial === 'owned' ? 'original' : null),
        'pre-admission ledger detached',
      )
      this.verify(this.alive.has('original'), 'pre-admission healthy runtime killed')
    }
    for (const [id, nodeId] of this.alive) {
      if (!this.referenced(id)) {
        this.verify(
          cleanupIds.includes(id) || (!quiescent && this.technical.has(id)),
          `${id}: missing cleanup`,
        )
      }
      this.verify(nodeId === 'agent', `${id}: foreign runtime`)
    }
    if (quiescent) {
      this.verify(cleanupIds.length === 0, 'cleanup did not converge after recovery of its ports')
      this.verify(this.technical.size === 0, 'technical runtime custody was not handed off')
      for (const id of [this.binding?.runtimeSessionId, this.present ? this.nodeRuntime : null]) {
        if (id) {
          this.verify(this.alive.get(id) === 'agent', `${id}: dead/foreign reference`)
        }
      }
    }
  }

  assertValid(): void {
    expect(this.violations, this.trace.join('\n')).toEqual([])
  }

  private verify(valid: boolean, failure: string): void {
    if (!valid) {
      this.violations.push(`${failure} at ${this.trace.at(-1) ?? 'initial'}`)
    }
  }
}
