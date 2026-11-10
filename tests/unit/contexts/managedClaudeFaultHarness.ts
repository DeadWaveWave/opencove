import { AsyncLocalStorage } from 'node:async_hooks'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { AppStateCommittedObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { ActivateManagedClaudeRuntimeInput } from '../../../src/shared/contracts/managedClaudeResumeBinding'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from './controlSurfaceTestTerminalAvailability'
import { context } from './managedClaudeLaunchCompatibility.helpers'
import { ManagedClaudeFaultModel, type FaultCase, type EffectStep } from './managedClaudeFaultModel'

export async function faultHarness(config: FaultCase) {
  const model = new ManagedClaudeFaultModel(config.initial)
  const actor = new AsyncLocalStorage<{ name: string; epoch: number }>()
  const tasks: { done: boolean; value?: unknown }[] = []
  const commits = new Set<(event: AppStateCommittedObservation) => void>()
  const reads = new Map<string, number>()
  let eventReached = false,
    faultReached = false,
    stopped = false,
    quiet = false
  let faultBudget = config.fault.endsWith('Failure') ? 2 : 1
  let latestInput: ActivateManagedClaudeRuntimeInput | undefined
  let runtime!: ReturnType<typeof createManagedClaudeLaunchRuntime>
  let surface!: ReturnType<typeof createControlSurface>
  let admissionInvoked = false

  const remember = (promise: Promise<unknown>, name: string) => {
    const task = { done: false, value: undefined as unknown }
    tasks.push(task)
    void promise
      .then(
        value => {
          task.value = value
        },
        error => {
          task.value = error
        },
      )
      .finally(() => {
        task.done = true
        for (const [id, owner] of model.technical) {
          if (owner === name) {
            model.technical.delete(id)
          }
        }
        check()
      })
    return task
  }
  const check = (quiescent = false) => {
    const ids = runtime?.owner.pendingCleanupRuntimeIds() ?? []
    for (const id of ids) {
      model.technical.delete(id)
    }
    model.check(ids, quiescent)
  }
  const launch = (name: string) =>
    actor.run({ name, epoch: model.epoch }, () =>
      remember(
        surface.invoke(context, {
          kind: 'command',
          id: 'session.launchAgent',
          payload: {
            canvasNodeId: 'agent',
            workspaceId: 'workspace',
            cwd: '/repo',
            prompt: 'fixture',
            provider: 'claude-code',
            intent: { kind: 'resumeCurrent' },
          },
        }),
        name,
      ),
    )
  const prepare = () =>
    actor.run({ name: 'prepare', epoch: model.epoch }, () =>
      remember(
        surface.invoke(context, {
          kind: 'command',
          id: 'session.prepareOrRevive',
          payload: { workspaceId: 'workspace' },
        }),
        'prepare',
      ),
    )

  const boundary = (step: EffectStep, side: 'before' | 'after') => {
    const activeActor = actor.getStore()
    if (activeActor && activeActor.epoch !== model.epoch) {
      throw new Error('Worker stopped')
    }
    const name = activeActor?.name ?? 'maintenance'
    model.trace.push(`${name}:${step}:${side}`)
    check()
    if (!quiet && name === 'primary' && !eventReached && config.edge === `${step}:${side}`) {
      eventReached = true
      if (config.event === 'delete') {
        const removed = model.remove()
        for (const listener of commits) {
          listener({
            revision: ++model.revision,
            removedNodeIds: ['agent'],
            removedManagedRuntimeSessionIds: removed,
          })
        }
      } else if (config.event === 'newer') {
        model.changedByOther = true
        launch('newer')
      } else if (config.event === 'prepare') {
        prepare()
      } else if (config.event === 'restart') {
        stopped = true
        runtime.dispose()
        model.stop()
      }
      check()
    }
    if (stopped && name === 'primary') {
      throw new Error('Worker stopped')
    }
  }
  const injected = (point: string) => {
    if (
      quiet ||
      actor.getStore()?.name !== 'primary' ||
      config.fault !== point ||
      faultBudget === 0
    ) {
      return false
    }
    faultBudget--
    faultReached = true
    return true
  }
  const fail = (point: string) => {
    if (injected(point)) {
      throw new Error(`injected ${point}`)
    }
  }

  const store = {
    readAppState: async () => {
      const name = actor.getStore()?.name ?? 'maintenance'
      const count = reads.get(name) ?? 0
      reads.set(name, count + 1)
      if (count === 0) {
        boundary('identity', 'before')
        fail('identity')
      }
      const state = model.appState()
      if (count === 0) {
        boundary('identity', 'after')
      }
      return state
    },
    observeManagedClaudeNode: (id: string) => {
      const confirm = latestInput && model.binding?.activationId === latestInput.activationId
      const step = latestInput?.runtimeSessionId === null ? 'handoffConfirmation' : 'confirmation'
      if (confirm) {
        boundary(step, 'before')
        fail(step)
      }
      const result = model.observation(id)
      if (confirm) {
        boundary(step, 'after')
      }
      return result
    },
    isManagedClaudeRuntimeReferenced: (id: string) => {
      boundary('referenceRead', 'before')
      fail('referenceRead')
      const referenced = model.referenced(id)
      boundary('referenceRead', 'after')
      return referenced
    },
    managedClaudePreparationCandidates: () => (model.present ? ['agent'] : []),
    onAppStateCommitted: (listener: (event: AppStateCommittedObservation) => void) => {
      commits.add(listener)
      return () => {
        commits.delete(listener)
      }
    },
    activateManagedClaudeRuntime: async (input: ActivateManagedClaudeRuntimeInput) => {
      const step = input.runtimeSessionId === null ? 'handoff' : 'activation'
      if (actor.getStore()?.name === 'primary' && admissionInvoked) {
        model.effectAdmitted = true
      }
      boundary(step, 'before')
      if (injected(`${step}Failure`)) {
        return { status: 'retryableFailure' as const, outcome: 'notCommitted' as const }
      }
      if (injected(`${step}Unknown`)) {
        model.blockedRead = true
        return { status: 'retryableFailure' as const, outcome: 'unknown' as const }
      }
      if (step === 'activation' && injected('activationSuperseded')) {
        return { status: 'superseded' as const }
      }
      if (step === 'activation' && injected('activationNodeGone')) {
        model.remove()
        runtime.owner.noteNodesDeleted(['agent'])
        return { status: 'nodeGone' as const }
      }
      const result = model.activate(input)
      latestInput = input
      boundary(step, 'after')
      if (injected(`${step}UnknownCommitted`)) {
        model.blockedRead = true
        return { status: 'retryableFailure' as const, outcome: 'unknown' as const }
      }
      return result
    },
  } as unknown as PersistenceStore

  const boot = async () => {
    latestInput = undefined
    admissionInvoked = false
    runtime = createManagedClaudeLaunchRuntime({
      getPersistenceStore: async () => store,
      adoptionEnabled: () => config.initial === 'adoption',
      hasRuntime: id => model.alive.has(id),
      killExactRuntime: async id => {
        const step =
          id === 'original' && config.initial === 'owned' ? 'admissionKill' : 'cleanupKill'
        if (actor.getStore()?.name === 'primary' && admissionInvoked) {
          model.effectAdmitted = true
        }
        boundary(step, 'before')
        model.killAttempts.set(id, (model.killAttempts.get(id) ?? 0) + 1)
        fail(step)
        model.kill(id)
        boundary(step, 'after')
      },
      publishCommittedActivation: () => {
        boundary('finalization', 'before')
        fail('finalization')
        boundary('finalization', 'after')
      },
    })
    const admit = runtime.owner.admit.bind(runtime.owner)
    runtime.owner.admit = async (...args) => {
      if (actor.getStore()?.name === 'primary') {
        admissionInvoked = true
      }
      const result = await admit(...args)
      if (actor.getStore()?.name === 'primary' && result === 'managed') {
        model.effectAdmitted = true
      }
      return result
    }
    const admission = createReadyTerminalAdmissionDeps()
    surface = createControlSurface({
      run: createCanvasSpawnRunner({
        managedClaude: runtime,
        terminalRuntimeAvailability: admission.terminalSpawnAdmission,
        getPersistenceStore: async () => store,
      }),
    })
    const registry = createTestAgentProviderRegistry()
    Object.assign(registry.require('claude-code').launcher, {
      createLaunchPlan: async () => ({
        command: '/bin/sh',
        args: [],
        env: {},
        effectiveModel: null,
        launchMode: 'resume',
        resumeSessionId: 'original',
      }),
    })
    registerSessionHandlers(surface, {
      ...admission,
      userDataPath: '/tmp/opencove-fault-model',
      getPersistenceStore: async () => store,
      approvedWorkspaces: {
        isPathApproved: async () => {
          boundary('validation', 'before')
          const allowed = !injected('validation')
          boundary('validation', 'after')
          return allowed
        },
      } as never,
      agentProviderRegistry: registry,
      topology: {} as never,
      ptyRuntime: {
        spawnSession: async () => {
          boundary('spawn', 'before')
          fail('spawn')
          const id = model.spawn(actor.getStore()?.name ?? 'prepare')
          boundary('spawn', 'after')
          return { sessionId: id }
        },
      } as never,
      ptyStreamHub: {
        isSessionActive: (id: string) => model.alive.has(id),
        registerSessionMetadata: () => {
          boundary('registration', 'before')
          fail('registration')
          boundary('registration', 'after')
        },
      } as never,
    })
    await runtime.ready()
  }
  await boot()

  const completePrimary = async () => {
    for (let turn = 0; turn < 250 && !tasks[0]?.done; turn++) {
      // oxlint-disable-next-line no-await-in-loop
      await Promise.resolve()
    }
    if (!tasks[0]?.done) {
      throw new Error(`primary stalled\n${model.trace.join('\n')}`)
    }
  }
  const settle = async () => {
    await completePrimary()
    quiet = true
    model.blockedRead = false
    if (stopped) {
      stopped = false
      await boot()
      if (model.present) {
        prepare()
      }
    }
    for (let turn = 0; turn < 250; turn++) {
      // This is a deterministic microtask scheduler, not a wall-clock sleep.
      // oxlint-disable-next-line no-await-in-loop
      await Promise.resolve()
      if (tasks.every(task => task.done)) {
        break
      }
      if (turn === 249) {
        throw new Error(`fault explorer stalled\n${model.trace.join('\n')}`)
      }
    }
    // Reconcile unknown writes using actual owner reads; retries have no new side effects.
    const next = runtime.owner.reserve('maintenance')
    await runtime.owner.assertReady(next).catch(() => {})
    const agent = runtime.owner.reserve('agent')
    await runtime.owner.assertReady(agent).catch(() => {})
    for (let turn = 0; turn < 30; turn++) {
      // oxlint-disable-next-line no-await-in-loop
      await Promise.resolve()
    }
    check(true)
  }
  return {
    model,
    config,
    start: () => launch('primary'),
    settle,
    completePrimary,
    pending: () => runtime.owner.pendingCleanupRuntimeIds(),
    primary: () => tasks[0]?.value,
    coverage: () => ({ faultReached, eventReached }),
    dispose: () => {
      runtime.dispose()
      commits.clear()
      actor.disable()
    },
  }
}
