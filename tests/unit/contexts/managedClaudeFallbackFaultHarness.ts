import { AsyncLocalStorage, AsyncResource } from 'node:async_hooks'
import { vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { createCanvasSpawnRunner } from '../../../src/app/main/controlSurface/createCanvasSpawnRunner'
import { createManagedClaudeLaunchRuntime } from '../../../src/app/main/controlSurface/managedClaudeLaunchRuntime'
import { registerSessionHandlers } from '../../../src/app/main/controlSurface/handlers/sessionHandlers'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { registerPtyMountHandlers } from '../../../src/app/main/controlSurface/handlers/ptyMountHandlers'
import { registerOperation } from '../../../src/app/main/controlSurface/registerOperation'
import { mountListOperation } from '../../../src/shared/contracts/controlSurface/operations/domains/mount'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
import type { AppStateCommittedObservation } from '../../../src/shared/contracts/managedClaudeLaunch'
import type { TerminalAgentActivityEnvironmentService } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { ManagedClaudeFaultModel, type FallbackStep } from './managedClaudeFaultModel'
import { ManagedClaudeFaultOracle } from './managedClaudeFaultOracle'
import { assertFallbackOutcomes } from './managedClaudeFallbackFaultAssertions'
import type { ShellCase } from './managedClaudeFallbackFaultCases'
import {
  drainFaultMicrotasks,
  waitForFaultTask,
  drainFaultTimers,
} from './managedClaudeFaultScheduler'
import { context } from './managedClaudeLaunchCompatibility.helpers'
import {
  createReadyTerminalAdmissionDeps,
  createTestAgentProviderRegistry,
} from './controlSurfaceTestTerminalAvailability'

export async function fallbackFaultHarness(config: ShellCase) {
  const model = new ManagedClaudeFaultModel('fallback', 'agent', true)
  model.nodeRuntime = null
  model.changedByOther = true
  model.workerBinding = config.route === 'mount' ? { endpointId: 'local', mountId: 'mount' } : null
  model.committed.set('initial', { runtimeSessionId: null, tuple: model.tuple })
  const peer = new ManagedClaudeFaultModel('owned', 'peer')
  const models = [model, peer]
  const oracle = new ManagedClaudeFaultOracle(models)
  const ingress = new AsyncResource('fallback-request')
  const actor = new AsyncLocalStorage<{ name: string; nodeId: string }>()
  const commits = new Set<(event: AppStateCommittedObservation) => void>()
  const tasks: {
    name: string
    nodeId: string
    kind: 'launch' | 'prepare'
    done: boolean
    value?: unknown
  }[] = []
  const preparedActivity = new Set<string>()
  const artifacts = new Map<string, boolean>()
  const scopes = new Map<string, { dispose(): Promise<void> }>()
  let publishedShell: string | undefined
  const mount = {
    mountId: 'mount',
    endpointId: 'local',
    rootUri: 'file:///repo',
    rootPath: '/repo',
    projectId: 'workspace',
    targetId: 'target',
  }
  let eventReached = false,
    eventAfterReturn = false,
    faultReached = false,
    quiet = false,
    stopped = false
  let runtime!: ReturnType<typeof createManagedClaudeLaunchRuntime>
  let surface!: ReturnType<typeof createControlSurface>
  const name = () => actor.getStore()?.name ?? 'timer'
  const node = (id = actor.getStore()?.nodeId ?? 'agent') =>
    models.find(value => value.nodeId === id)!
  const byRuntime = (id: string) =>
    models.find(value => value.original === id || value.created.has(id))!
  const check = (quiescent = false) => {
    const ids = runtime.owner.pendingCleanupRuntimeIds()
    for (const value of models) {
      ids.forEach(id => value.technical.delete(id))
      value.check(ids, quiescent)
    }
  }
  const fail = (point: ShellCase['fault']) => {
    if (!quiet && name() === 'primary' && !faultReached && config.fault === point) {
      faultReached = true
      throw new Error(`injected ${point}`)
    }
  }
  function emit(removedNodeIds: string[] = [], removed: string[] = []) {
    for (const listener of commits) {
      listener({
        revision: ++model.revision,
        removedNodeIds,
        removedRuntimeSessionIds: removed,
        removedManagedRuntimeSessionIds: removed,
      })
    }
  }
  function remove(nodeId = 'agent') {
    emit([nodeId], node(nodeId).remove())
  }
  function persist() {
    boundary('shellPersistence', 'before')
    const shell = publishedShell
    if (model.present && model.binding?.runtimeSessionId === null && shell) {
      model.nodeRuntime = shell
    }
    emit()
    boundary('shellPersistence', 'after')
  }
  function request(requestName: string, nodeId = 'agent', kind: 'launch' | 'prepare' = 'prepare') {
    oracle.begin(requestName, nodeId, kind)
    const task = { name: requestName, nodeId, kind, done: false, value: undefined as unknown }
    tasks.push(task)
    ingress.runInAsyncScope(() =>
      actor.run({ name: requestName, nodeId }, () => {
        void surface
          .invoke(
            context,
            kind === 'prepare'
              ? {
                  kind: 'command',
                  id: 'session.prepareOrRevive',
                  payload: { workspaceId: 'workspace', nodeIds: [nodeId] },
                }
              : {
                  kind: 'command',
                  id:
                    nodeId === 'agent' && config.route === 'mount'
                      ? 'session.launchAgentInMount'
                      : 'session.launchAgent',
                  payload: {
                    canvasNodeId: nodeId,
                    workspaceId: 'workspace',
                    cwd: '/repo',
                    ...(nodeId === 'agent' && config.route === 'mount'
                      ? { mountId: 'mount', cwdUri: 'file:///repo' }
                      : {}),
                    provider: 'claude-code',
                    prompt: 'fixture',
                    intent: { kind: 'resumeCurrent' },
                  },
                },
          )
          .then(
            value => {
              if (nodeId === 'agent' && value.ok) {
                publishedShell = (value.value as { nodes?: { sessionId: string }[] }).nodes?.[0]
                  ?.sessionId
              }
              if (requestName === 'primary') {
                boundary('shellReturn', 'before')
              }
              task.value = value
              if (requestName === 'primary') {
                boundary('shellReturn', 'after')
              }
            },
            error => {
              task.value = error
            },
          )
          .finally(() => {
            task.done = true
            oracle.end(requestName)
            for (const value of models) {
              for (const [id, owner] of value.technical) {
                if (owner === requestName) {
                  value.technical.delete(id)
                }
              }
            }
            check()
          })
      }),
    )
    return task
  }
  function boundary(step: FallbackStep, side: 'before' | 'after') {
    node().trace.push(`${name()}:${step}:${side}`)
    check()
    if (!quiet && name() === 'primary' && !eventReached && config.edge === `${step}:${side}`) {
      eventReached = true
      eventAfterReturn = tasks[0]?.done ?? false
      if (config.event === 'delete') {
        remove()
      }
      if (config.event === 'newer') {
        oracle.begin('superseding', 'agent')
        model.changedByOther = true
        runtime.owner.reserve('agent')
      }
      if (config.event === 'replace') {
        model.changedByOther = true
        request('replacement', 'agent', 'launch')
      }
      if (config.event === 'persist') {
        persist()
      }
      if (config.event === 'prepare') {
        request('joining')
      }
      if (config.event === 'peerLaunch') {
        request('peer-launch', 'peer', 'launch')
      }
      if (config.event === 'peerRecovery') {
        peer.alive.clear()
        peer.changedByOther = true
        request('peer-recovery', 'peer')
      }
      if (config.event === 'peerDelete') {
        remove('peer')
      }
      if (config.event === 'restart') {
        stopped = true
        runtime.dispose()
        models.forEach(value => value.stop())
        oracle.restart()
      }
    }
  }
  const store = {
    readAppState: async () => {
      const state = model.appState()
      state.workspaces[0].nodes.push(...peer.appState().workspaces[0].nodes)
      for (const value of state.workspaces[0].nodes) {
        if (value.id === 'agent') {
          value.status = config.mode === 'stopped' ? 'stopped' : 'standby'
          if (config.route === 'mount') {
            Object.assign(value, { workerBinding: { endpointId: 'local', mountId: 'mount' } })
          }
        }
      }
      oracle.identity(name())
      return state
    },
    observeManagedClaudeNode: (id: string) => {
      const value = node(id),
        observed = value.observation(id)
      if (id === 'agent' && observed.context && config.route === 'mount') {
        observed.context.route = JSON.stringify({ endpointId: 'local', mountId: 'mount' })
      }
      return observed
    },
    isManagedClaudeRuntimeReferenced: (id: string) => {
      boundary('referenceRead', 'before')
      fail('referenceRead')
      const result = models.some(value => value.referenced(id))
      boundary('referenceRead', 'after')
      return result
    },
    managedClaudePreparationCandidates: (_workspace: string, ids?: string[]) =>
      models
        .filter(value => value.present && (!ids || ids.includes(value.nodeId)))
        .map(value => value.nodeId),
    onAppStateCommitted: (listener: (event: AppStateCommittedObservation) => void) => {
      commits.add(listener)
      return () => {
        commits.delete(listener)
      }
    },
    activateManagedClaudeRuntime: async input => {
      oracle.effect(name())
      return node(input.nodeId).activate(input)
    },
  } as PersistenceStore
  const boot = async () => {
    runtime = createManagedClaudeLaunchRuntime({
      getPersistenceStore: async () => store,
      adoptionEnabled: () => false,
      hasRuntime: id => models.some(value => value.alive.has(id)),
      killExactRuntime: async id => {
        boundary('cleanupKill', 'before')
        const value = byRuntime(id)
        value.killAttempts.set(id, (value.killAttempts.get(id) ?? 0) + 1)
        fail('cleanupKill')
        value.kill(id)
        await scopes.get(id)?.dispose()
        boundary('cleanupKill', 'after')
      },
    })
    const admission = createReadyTerminalAdmissionDeps()
    const run = createCanvasSpawnRunner({
      managedClaude: runtime,
      terminalRuntimeAvailability: admission.terminalSpawnAdmission,
      getPersistenceStore: async () => store,
    })
    surface = createControlSurface({
      run: (ctx, wire, execute, payload) =>
        run(
          ctx,
          wire,
          admitted => {
            const current = admitted ?? ctx
            const pty = wire.id === 'pty.spawn' || wire.id === 'pty.spawnInMount'
            const guard = (assertActive?: () => void) => () => {
              if (preparedActivity.has(name())) {
                boundary('shellSpawn', 'before')
              }
              assertActive?.()
            }
            return execute(
              pty
                ? {
                    ...current,
                    assertActive: guard(current.assertActive),
                    terminalSpawnLifecycle: current.terminalSpawnLifecycle
                      ? {
                          ...current.terminalSpawnLifecycle,
                          assertActive: guard(current.terminalSpawnLifecycle.assertActive),
                        }
                      : undefined,
                  }
                : current,
            )
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
      }),
    })
    const deps = {
      ...admission,
      userDataPath: '/tmp/opencove-fallback-model',
      getPersistenceStore: async () => store,
      approvedWorkspaces: {
        isPathApproved: async () => {
          oracle.approve(name(), true)
          return true
        },
      } as never,
      topology: { resolveMountTarget: async () => mount } as never,
      agentProviderRegistry: registry,
      terminalAgentActivity: {
        prepare: async (input: { command: string; args: string[]; environment: object }) => {
          boundary('shellActivity', 'before')
          await Promise.resolve()
          fail('activity')
          boundary('shellActivity', 'after')
          preparedActivity.add(name())
          const key = `prepared-${name()}`
          artifacts.set(key, true)
          let owner = key
          return {
            ...input,
            dispose: () => {
              artifacts.delete(owner)
            },
            commit: (id: string) => {
              fail('activityCommit')
              artifacts.delete(owner)
              owner = id
              artifacts.set(id, true)
            },
          }
        },
      } as unknown as TerminalAgentActivityEnvironmentService,
      ptyRuntime: {
        spawnSession: async (input: {
          agentProvider?: string
          launchArtifacts?: { dispose(): Promise<void> }
        }) => {
          if (input.agentProvider) {
            if (name() === 'primary' && config.mode === 'failedResume') {
              throw new Error('resume failed')
            }
            oracle.effect(name())
            return { sessionId: node().spawn(name()) }
          }
          oracle.shellStart(name())
          try {
            fail('spawn')
          } catch (error) {
            await input.launchArtifacts?.dispose()
            throw error
          }
          const id = node().spawn(name(), 'shell')
          if (input.launchArtifacts) {
            scopes.set(id, input.launchArtifacts)
          }
          boundary('shellSpawn', 'after')
          return { sessionId: id }
        },
      } as never,
      ptyStreamHub: {
        isSessionActive: (id: string) => models.some(value => value.alive.has(id)),
        registerSessionMetadata: (input: { kind: string }) => {
          if (input.kind === 'terminal') {
            boundary('shellRegistration', 'before')
            fail('registration')
            boundary('shellRegistration', 'after')
          }
        },
      } as never,
    }
    registerSessionHandlers(surface, deps)
    registerSessionStreamingHandlers(surface, deps)
    registerPtyMountHandlers(surface, deps)
    registerOperation(surface, mountListOperation, {
      handle: async () => ({ mounts: [mount] }),
      defaultErrorCode: 'common.unexpected',
    })
    await runtime.ready()
  }
  const profile = vi
    .spyOn(TerminalProfileResolver.prototype, 'resolveTerminalSpawn')
    .mockImplementation(async input => {
      boundary('shellProfile', 'before')
      await Promise.resolve()
      fail('profile')
      boundary('shellProfile', 'after')
      return {
        cwd: input.cwd,
        command: '/bin/sh',
        args: [],
        env: {},
        profileId: null,
        runtimeKind: 'posix',
      }
    })
  await boot()
  const until = (done: () => boolean) =>
    waitForFaultTask(done, () => models.flatMap(value => value.trace).join('\n'))
  async function settle() {
    await until(() => tasks[0]?.done)
    if (config.handoff === 'persist') {
      ingress.runInAsyncScope(() => actor.run({ name: 'primary', nodeId: 'agent' }, persist))
    }
    quiet = true
    await until(() => tasks.every(value => value.done))
    await drainFaultMicrotasks()
    if (stopped) {
      stopped = false
      artifacts.clear()
      await boot()
      for (const value of models.filter(candidate => candidate.present)) {
        request(`restart-${value.nodeId}`, value.nodeId)
      }
      await until(() => tasks.every(value => value.done))
      const recovered = tasks.find(task => task.name === 'restart-agent')?.value as {
        value?: { nodes: { sessionId: string }[] }
      }
      publishedShell = recovered?.value?.nodes[0]?.sessionId
      ingress.runInAsyncScope(persist)
    }
    await drainFaultTimers()
    await until(() => tasks.every(value => value.done))
    if (config.handoff === 'persist') {
      ingress.runInAsyncScope(persist)
    }
    await drainFaultMicrotasks()
    await drainFaultTimers()
    assertFallbackOutcomes({ tasks, config, eventReached, eventAfterReturn, faultReached, oracle })
    check(true)
    model.verify(
      [...artifacts.keys()].every(id => models.some(value => value.alive.has(id))),
      'orphaned activity artifact',
    )
  }
  return {
    model,
    peer,
    models,
    oracle,
    tasks,
    runtime: () => runtime,
    request,
    remove,
    persist,
    start: () => request('primary'),
    settle,
    until,
    pending: () => runtime.owner.pendingCleanupRuntimeIds(),
    coverage: () => ({ faultReached, eventReached }),
    dispose: () => {
      runtime.dispose()
      profile.mockRestore()
      actor.disable()
      ingress.emitDestroy()
    },
  }
}
