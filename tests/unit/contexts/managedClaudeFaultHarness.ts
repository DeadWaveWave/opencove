import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks'
import { vi } from 'vitest'
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
import { context, deferred } from './managedClaudeLaunchCompatibility.helpers'
import { ManagedClaudeFaultModel, type FaultCase, type EffectStep } from './managedClaudeFaultModel'
import { ManagedClaudeFaultOracle } from './managedClaudeFaultOracle'

export async function faultHarness(config: FaultCase) {
  const model = new ManagedClaudeFaultModel(config.initial)
  const peer = new ManagedClaudeFaultModel('owned', 'peer')
  const models = [model, peer]
  const ingress = new AsyncResource('managed-Claude-request')
  const oracle = new ManagedClaudeFaultOracle(models)
  const actor = new AsyncLocalStorage<{ name: string; nodeId: string; epoch: number }>()
  const tasks: { name: string; nodeId: string; done: boolean; value?: unknown }[] = []
  const commits = new Set<(event: AppStateCommittedObservation) => void>()
  const reads = new Map<string, number>()
  const latest = new Map<string, ActivateManagedClaudeRuntimeInput>()
  const gates = new Map<string, { entered: boolean; release: ReturnType<typeof deferred<void>> }>()
  let eventReached = false,
    faultReached = false,
    stopped = false,
    quiet = false
  let faultBudget = config.fault.endsWith('Failure') ? 2 : 1
  let runtime!: ReturnType<typeof createManagedClaudeLaunchRuntime>
  let surface!: ReturnType<typeof createControlSurface>
  const node = (id = actor.getStore()?.nodeId ?? 'agent') =>
    models.find(value => value.nodeId === id)!
  const byRuntime = (id: string) =>
    models.find(value => value.original === id || value.created.has(id))!
  const name = () => actor.getStore()?.name ?? 'timer'
  const check = (quiescent = false) => {
    const ids = runtime?.owner.pendingCleanupRuntimeIds() ?? []
    for (const value of models) {
      for (const id of ids) {
        value.technical.delete(id)
      }
      value.check(ids, quiescent)
    }
  }
  const remember = (promise: Promise<unknown>, request: string, nodeId: string) => {
    const task = { name: request, nodeId, done: false, value: undefined as unknown }
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
        oracle.end(request)
        for (const value of models) {
          for (const [id, owner] of value.technical) {
            if (owner === request) {
              value.technical.delete(id)
            }
          }
        }
        check()
      })
    return task
  }
  const launch = (request: string, nodeId = 'agent') => {
    oracle.begin(request, nodeId)
    return ingress.runInAsyncScope(() =>
      actor.run({ name: request, nodeId, epoch: model.epoch }, () =>
        remember(
          surface.invoke(context, {
            kind: 'command',
            id: 'session.launchAgent',
            payload: {
              canvasNodeId: nodeId,
              workspaceId: 'workspace',
              cwd: '/repo',
              prompt: 'fixture',
              provider: 'claude-code',
              intent: { kind: 'resumeCurrent' },
            },
          }),
          request,
          nodeId,
        ),
      ),
    )
  }
  const prepare = (nodeId = 'agent', request = 'prepare') => {
    oracle.begin(request, nodeId, 'prepare')
    return ingress.runInAsyncScope(() =>
      actor.run({ name: request, nodeId, epoch: model.epoch }, () =>
        remember(
          surface.invoke(context, {
            kind: 'command',
            id: 'session.prepareOrRevive',
            payload: { workspaceId: 'workspace', nodeIds: [nodeId] },
          }),
          request,
          nodeId,
        ),
      ),
    )
  }
  const remove = (nodeId: string) => {
    const value = node(nodeId)
    const removed = value.remove()
    for (const listener of commits) {
      listener({
        revision: ++value.revision,
        removedNodeIds: [nodeId],
        removedManagedRuntimeSessionIds: removed,
      })
    }
  }
  const boundary = (step: EffectStep, side: 'before' | 'after') => {
    const active = actor.getStore()
    if (active && active.epoch !== model.epoch) {
      throw new Error('Worker stopped')
    }
    node().trace.push(`${name()}:${step}:${side}`)
    check()
    if (!quiet && name() === 'primary' && !eventReached && config.edge === `${step}:${side}`) {
      eventReached = true
      if (config.event === 'delete') {
        remove('agent')
      } else if (config.event === 'newer') {
        model.changedByOther = true
        launch('newer')
      } else if (config.event === 'prepare') {
        prepare()
      } else if (config.event === 'peerLaunch') {
        launch('peer-launch', 'peer')
      } else if (config.event === 'peerRecovery') {
        peer.alive.delete(peer.original)
        peer.changedByOther = true
        prepare('peer', 'peer-prepare')
      } else if (config.event === 'peerDelete') {
        remove('peer')
      } else if (config.event === 'restart') {
        stopped = true
        runtime.dispose()
        models.forEach(value => value.stop())
        oracle.restart()
      }
      check()
    }
    if (stopped && name() === 'primary') {
      throw new Error('Worker stopped')
    }
  }
  const injected = (point: string, targetNode = node().nodeId) => {
    if (
      quiet ||
      targetNode !== 'agent' ||
      name() !== 'primary' ||
      config.fault !== point ||
      faultBudget === 0
    ) {
      return false
    }
    faultBudget--
    faultReached = true
    return true
  }
  const fail = (point: string, targetNode?: string) => {
    if (injected(point, targetNode)) {
      throw new Error(`injected ${point}`)
    }
  }
  const store = {
    readAppState: async () => {
      const count = reads.get(name()) ?? 0
      reads.set(name(), count + 1)
      if (count === 0) {
        boundary('identity', 'before')
        fail('identity')
      }
      const state = model.appState()
      state.workspaces[0].nodes.push(...peer.appState().workspaces[0].nodes)
      if (count === 0) {
        oracle.identity(name())
        boundary('identity', 'after')
      }
      return state
    },
    observeManagedClaudeNode: (id: string) => {
      const value = node(id),
        input = latest.get(id)
      const confirm = input && value.binding?.activationId === input.activationId
      const step = input?.runtimeSessionId === null ? 'handoffConfirmation' : 'confirmation'
      if (confirm) {
        boundary(step, 'before')
        fail(step, value.nodeId)
      }
      const result = value.observation(id)
      if (confirm) {
        boundary(step, 'after')
      }
      return result
    },
    isManagedClaudeRuntimeReferenced: (id: string) => {
      boundary('referenceRead', 'before')
      fail('referenceRead', byRuntime(id).nodeId)
      const referenced = models.some(value => value.referenced(id))
      boundary('referenceRead', 'after')
      return referenced
    },
    managedClaudePreparationCandidates: (_workspace: string, nodeIds?: string[]) =>
      models
        .filter(value => value.present && (!nodeIds || nodeIds.includes(value.nodeId)))
        .map(value => value.nodeId),
    onAppStateCommitted: (listener: (event: AppStateCommittedObservation) => void) => {
      commits.add(listener)
      return () => {
        commits.delete(listener)
      }
    },
    activateManagedClaudeRuntime: async (input: ActivateManagedClaudeRuntimeInput) => {
      oracle.effect(name())
      const value = node(input.nodeId),
        step = input.runtimeSessionId === null ? 'handoff' : 'activation'
      boundary(step, 'before')
      if (injected(`${step}Failure`)) {
        return { status: 'retryableFailure' as const, outcome: 'notCommitted' as const }
      }
      if (injected(`${step}Unknown`)) {
        value.blockedRead = true
        return { status: 'retryableFailure' as const, outcome: 'unknown' as const }
      }
      if (step === 'activation' && injected('activationSuperseded')) {
        return { status: 'superseded' as const }
      }
      if (step === 'activation' && injected('activationNodeGone')) {
        remove(value.nodeId)
        return { status: 'nodeGone' as const }
      }
      const result = value.activate(input)
      latest.set(value.nodeId, input)
      boundary(step, 'after')
      if (injected(`${step}UnknownCommitted`)) {
        value.blockedRead = true
        return { status: 'retryableFailure' as const, outcome: 'unknown' as const }
      }
      return result
    },
  } as unknown as PersistenceStore
  const boot = async () => {
    latest.clear()
    runtime = createManagedClaudeLaunchRuntime({
      getPersistenceStore: async () => store,
      adoptionEnabled: () => config.initial === 'adoption',
      hasRuntime: id => models.some(value => value.alive.has(id)),
      killExactRuntime: async id => {
        const value = byRuntime(id)
        const step =
          id === value.original && value.initial === 'owned' ? 'admissionKill' : 'cleanupKill'
        boundary(step, 'before')
        value.killAttempts.set(id, (value.killAttempts.get(id) ?? 0) + 1)
        fail(step, value.nodeId)
        value.kill(id)
        boundary(step, 'after')
      },
      publishCommittedActivation: () => {
        boundary('finalization', 'before')
        fail('finalization')
        boundary('finalization', 'after')
      },
    })
    const admission = createReadyTerminalAdmissionDeps()
    const run = createCanvasSpawnRunner({
      managedClaude: runtime,
      terminalRuntimeAvailability: admission.terminalSpawnAdmission,
      getPersistenceStore: async () => store,
    })
    surface = createControlSurface({
      run: (ctx, request, execute, payload) =>
        run(
          ctx,
          request,
          async admitted => {
            const result = await execute(admitted)
            const gate = gates.get(actor.getStore()?.nodeId ?? '')
            if (gate && request.id === 'session.launchAgent') {
              gate.entered = true
              await gate.release.promise
            }
            return result
          },
          payload,
        ),
    })
    const registry = createTestAgentProviderRegistry()
    Object.assign(registry.require('claude-code').launcher, {
      createLaunchPlan: async () => ({
        command: '/bin/sh',
        args: [],
        env: {},
        effectiveModel: null,
        launchMode: 'resume',
        resumeSessionId: node().tuple.resumeSessionId,
        onStarted: () => {
          fail('onStarted')
        },
      }),
    })
    registerSessionHandlers(surface, {
      ...admission,
      userDataPath: '/tmp/opencove-fault-model',
      cleanupUnreferencedSession: id => runtime.owner.cleanup(id),
      getPersistenceStore: async () => store,
      approvedWorkspaces: {
        isPathApproved: async () => {
          boundary('validation', 'before')
          const allowed = !injected('validation')
          oracle.approve(name(), allowed)
          boundary('validation', 'after')
          return allowed
        },
      } as never,
      agentProviderRegistry: registry,
      topology: {} as never,
      ptyRuntime: {
        spawnSession: async () => {
          oracle.effect(name())
          boundary('spawn', 'before')
          fail('spawn')
          const id = node().spawn(name())
          boundary('spawn', 'after')
          return { sessionId: id }
        },
      } as never,
      ptyStreamHub: {
        isSessionActive: (id: string) => models.some(value => value.alive.has(id)),
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
  const turns = async (done: () => boolean) => {
    for (let turn = 0; turn < 500 && !done(); turn++) {
      // Deterministic scheduler; it neither creates requests nor invokes lifecycle helpers.
      await Promise.resolve()
    }
    if (!done()) {
      throw new Error(`fault explorer stalled\n${models.flatMap(value => value.trace).join('\n')}`)
    }
  }
  const completePrimary = () => turns(() => tasks[0]?.done)
  const settle = async () => {
    await completePrimary()
    quiet = true
    if (!config.outageRetries) {
      models.forEach(value => {
        value.blockedRead = false
      })
    }
    if (stopped) {
      stopped = false
      await boot()
      for (const value of models.filter(candidate => candidate.present)) {
        prepare(value.nodeId, `restart-${value.nodeId}`)
      }
    }
    await turns(() => tasks.every(task => task.done))
    for (let timer = 0; timer < 20 && vi.getTimerCount() > 0; timer++) {
      if (config.outageRetries && timer >= config.outageRetries) {
        models.forEach(value => {
          value.blockedRead = false
        })
      }
      // Only execute timers scheduled by the product, including retry/reconciliation.
      await vi.advanceTimersToNextTimerAsync()
    }
    models.forEach(value => {
      value.blockedRead = false
    })
    for (const task of tasks) {
      oracle.outcome(task.name, task.value, config, faultReached, eventReached)
    }
    check(true)
  }
  return {
    runtime: () => runtime,
    cleanup: (sessionId: string) =>
      ingress.runInAsyncScope(() =>
        surface.invoke(context, {
          kind: 'command',
          id: 'session.cleanupUnreferenced',
          payload: { sessionId },
        }),
      ),
    model,
    peer,
    models,
    oracle,
    config,
    start: () => launch('primary'),
    launch,
    prepare,
    remove,
    settle,
    completePrimary,
    pending: () => runtime.owner.pendingCleanupRuntimeIds(),
    primary: () => tasks[0]?.value,
    tasks,
    until: turns,
    coverage: () => ({ faultReached, eventReached }),
    pause: (nodeId: string) => {
      gates.set(nodeId, { entered: false, release: deferred<void>() })
    },
    paused: (nodeId: string) => gates.get(nodeId)?.entered === true,
    release: (nodeId: string) => {
      gates.get(nodeId)?.release.resolve()
      gates.delete(nodeId)
    },
    dispose: () => {
      runtime.dispose()
      commits.clear()
      actor.disable()
      ingress.emitDestroy()
    },
  }
}
