import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import {
  ManagedClaudeLaunchOwner,
  rejectManagedLaunch,
} from '../../../contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { resolveManagedClaudeLaunchIntent } from '../../../contexts/agent/application/managedClaudeLaunch/managedClaudeLaunchIntent'
import type { ManagedClaudeLaunchAttempt } from '../../../contexts/agent/application/managedClaudeLaunch/types'
import type { PersistenceStore } from '../../../platform/persistence/sqlite/PersistenceStore'
import type {
  LaunchAgentSessionInput,
  LaunchAgentSessionResult,
} from '../../../shared/contracts/dto'
import type {
  ManagedClaudeLifecycleReceipt,
  ManagedClaudeBindingObservation,
} from '../../../shared/contracts/managedClaudeLaunch'
import type { ControlSurfaceContext } from './types'
import type { CanvasSpawnIdentity } from './sessionSpawnIdentityContext'
import { createAppError, toAppErrorDescriptor } from '../../../shared/errors/appError'

interface LaunchScope {
  attempt: ManagedClaudeLaunchAttempt
  phase: 'candidate' | 'managed' | 'legacy'
  owner: ManagedClaudeLaunchOwner
  launching?: boolean
  spawnStarted?: boolean
  releasePending?: () => void
  trackPending?: () => void
  store?: PersistenceStore
}
const scope = new AsyncLocalStorage<LaunchScope>()

/** Technical adapter called once provider, directory and local execution have been resolved. */
export async function admitManagedClaudeLaunch(
  provider: string,
  cwd: string,
  mountId: string | null = null,
): Promise<void> {
  const current = scope.getStore()
  if (!current || current.phase === 'legacy') {
    return
  }
  const { attempt } = current
  if (provider !== 'claude-code') {
    if (attempt.expected?.activationId) {
      rejectManagedLaunch(attempt.nodeId, 'identityConflict')
    }
    current.phase = 'legacy'
    current.releasePending?.()
    return
  }
  if (!current.store?.activateManagedClaudeRuntime) {
    rejectManagedLaunch(attempt.nodeId, 'capabilityUnavailable')
  }
  current.phase = 'managed'
  current.trackPending?.()
  if ((await current.owner.admit(attempt, { provider, cwd, mountId })) === 'legacy') {
    current.phase = 'legacy'
    current.releasePending?.()
  }
}

export function createManagedClaudeLaunchRuntime(deps: {
  getPersistenceStore(): Promise<PersistenceStore>
  killExactRuntime(id: string): Promise<void>
  hasRuntime(id: string): boolean
  adoptionEnabled(): boolean
  publishCommittedActivation?: ConstructorParameters<
    typeof ManagedClaudeLaunchOwner
  >[0]['publishCommittedActivation']
}) {
  let store: PersistenceStore | undefined
  const pendingLaunches = new Map<string, { promise: Promise<void>; resolve: () => void }>()
  const preparing = new Map<string, ManagedClaudeLaunchAttempt>()
  let unsubscribe: (() => void) | undefined
  const unavailable = (): never => {
    throw createAppError('persistence.unavailable')
  }
  const owner = new ManagedClaudeLaunchOwner({
    createId: randomUUID,
    scheduleReconciliation: (callback, delayMs) => {
      const timer = setTimeout(callback, delayMs)
      timer.unref()
      return () => clearTimeout(timer)
    },
    observeNode: id => store?.observeManagedClaudeNode?.(id) ?? unavailable(),
    isRuntimeReferenced: id => store?.isManagedClaudeRuntimeReferenced?.(id) ?? unavailable(),
    activateManagedClaudeRuntime: input =>
      store?.activateManagedClaudeRuntime?.(input) ?? unavailable(),
    killExactRuntime: deps.killExactRuntime,
    publishCommittedActivation: deps.publishCommittedActivation ?? (() => {}),
  })
  const ready = async () => {
    store = await deps.getPersistenceStore()
    if (!unsubscribe && store.onAppStateCommitted) {
      unsubscribe = store.onAppStateCommitted(event => {
        owner.noteNodesDeleted(event.removedNodeIds)
        for (const id of event.removedManagedRuntimeSessionIds) {
          void owner.cleanup(id)
        }
      })
    }
    return store
  }
  return {
    owner,
    ready,
    awaitPending: async (nodeId: string) => {
      for (;;) {
        const pending = pendingLaunches.get(nodeId)
        if (!pending) {
          return
        }
        // Supersession can replace this entry while it is pending.
        // oxlint-disable-next-line no-await-in-loop
        await pending.promise
      }
    },
    reservePreparation: (workspaceId: string, nodeIds?: readonly string[]) => {
      const attempts = new Map<string, ManagedClaudeLaunchAttempt>()
      for (const id of store?.managedClaudePreparationCandidates?.(workspaceId, nodeIds) ?? []) {
        if (pendingLaunches.has(id)) {
          continue
        }
        const observation = store?.observeManagedClaudeNode?.(id)
        if (
          !observation?.binding &&
          !(deps.adoptionEnabled() && observation?.context?.provider === 'claude-code')
        ) {
          continue
        }
        if (
          observation?.nodeRuntimeSessionId &&
          deps.hasRuntime(observation.nodeRuntimeSessionId)
        ) {
          continue
        }
        const pending = preparing.get(id)
        const attempt = pending && owner.isCurrent(pending) ? pending : owner.reserve(id)
        preparing.set(id, attempt)
        attempts.set(id, attempt)
      }
      return attempts
    },
    withPreparation: async <T>(
      attempt: ManagedClaudeLaunchAttempt,
      execute: () => Promise<T>,
    ): Promise<T> => {
      const localStore = await ready()
      const observation = localStore.observeManagedClaudeNode?.(attempt.nodeId)
      const managed = Boolean(
        observation?.binding ||
        (deps.adoptionEnabled() && observation?.context?.provider === 'claude-code'),
      )
      if (!managed) {
        return execute()
      }
      if (observation?.binding) {
        await owner.assertReady(attempt)
      }
      attempt.context = observation?.context
      try {
        return await scope.run(
          {
            attempt,
            phase: observation?.binding ? 'managed' : 'candidate',
            owner,
            store: localStore,
          },
          execute,
        )
      } finally {
        if (preparing.get(attempt.nodeId) === attempt) {
          preparing.delete(attempt.nodeId)
        }
      }
    },
    dispose: () => {
      unsubscribe?.()
      owner.dispose()
      for (const pending of pendingLaunches.values()) {
        pending.resolve()
      }
      pendingLaunches.clear()
    },
    run: async (
      ctx: ControlSurfaceContext,
      wire: unknown,
      payload: LaunchAgentSessionInput,
      resolveIdentity: () => Promise<CanvasSpawnIdentity | undefined>,
      execute: (context: ControlSurfaceContext) => Promise<unknown>,
    ): Promise<unknown> => {
      const intent = ctx.managedClaudeIntent ?? payload.intent
      const inherited = scope.getStore()
      if (inherited?.launching) {
        return execute(ctx)
      }
      const input = wire as { canvasNodeId?: unknown }
      const nodeId = ctx.spawnIdentity?.nodeId ?? input?.canvasNodeId
      if (
        nodeId !== undefined &&
        nodeId !== null &&
        (typeof nodeId !== 'string' || !nodeId.trim() || nodeId.length > 256)
      ) {
        throw createAppError('common.invalid_input')
      }
      // Reserve before the first asynchronous identity/store read.
      const attempt =
        inherited?.attempt ?? (typeof nodeId === 'string' ? owner.reserve(nodeId) : null)
      let resolvePending!: () => void
      const pending = {
        promise: new Promise<void>(done => {
          resolvePending = done
        }),
        resolve: () => resolvePending(),
      }
      const releasePending = () => {
        pending.resolve()
        if (attempt && pendingLaunches.get(attempt.nodeId) === pending) {
          pendingLaunches.delete(attempt.nodeId)
        }
      }
      const trackPending = () => {
        if (attempt && owner.isCurrent(attempt)) {
          pendingLaunches.set(attempt.nodeId, pending)
        }
      }
      let launchStarted = false
      try {
        // Ready-store ownership is definitive before asynchronous identity resolution.
        // Unowned candidates coordinate only after managed local admission.
        if (attempt && store?.observeManagedClaudeNode?.(attempt.nodeId).binding) {
          trackPending()
        }
        let identity: CanvasSpawnIdentity | undefined
        try {
          identity = await resolveIdentity()
        } catch (error) {
          if (attempt && (await ready()).observeManagedClaudeNode?.(attempt.nodeId).retired) {
            rejectManagedLaunch(attempt.nodeId, 'nodeGone')
          }
          throw error
        }
        ctx.assertActive?.()
        if (!attempt || !identity?.nodeId || identity.delegated) {
          return execute(ctx)
        }
        const localStore = await ready()
        if (!localStore.observeManagedClaudeNode) {
          rejectManagedLaunch(attempt.nodeId, 'capabilityUnavailable')
        }
        let observation = localStore.observeManagedClaudeNode(attempt.nodeId)
        const capturedContext =
          attempt.context === undefined ? observation.context : attempt.context
        if (observation.retired) {
          rejectManagedLaunch(attempt.nodeId, 'nodeGone')
        }
        const managed = Boolean(
          observation.binding ||
          (deps.adoptionEnabled() &&
            intent &&
            (!payload.provider || payload.provider === 'claude-code')),
        )
        if (!managed) {
          return execute(ctx)
        }
        if (observation.binding) {
          trackPending()
          await owner.assertReady(attempt)
          observation = localStore.observeManagedClaudeNode(attempt.nodeId)
          if (observation.retired) {
            rejectManagedLaunch(attempt.nodeId, 'nodeGone')
          }
          if (!observation.binding) {
            rejectManagedLaunch(attempt.nodeId, 'conflict')
          }
        }
        const decision = observation.binding
          ? resolveManagedClaudeLaunchIntent(observation, { ...payload, intent })
          : null
        if (observation.binding && !localStore.activateManagedClaudeRuntime) {
          rejectManagedLaunch(attempt.nodeId, 'capabilityUnavailable')
        }
        attempt.context = capturedContext
        attempt.expected =
          decision?.expected ??
          (intent && intent.kind !== 'resumeCurrent'
            ? intent.expected
            : {
                activationId: null,
                tuple: { resumeSessionId: null, resumeSessionIdVerified: false },
              })
        if (decision) {
          Object.assign(payload, { mode: decision.mode, resumeSessionId: decision.resumeSessionId })
        }
        const executionScope: LaunchScope = {
          attempt,
          phase: observation.binding ? 'managed' : 'candidate',
          store: localStore,
          owner,
          launching: true,
          releasePending,
          trackPending,
        }
        const context = {
          ...ctx,
          assertActive: () => {
            ctx.assertActive?.()
            if (executionScope.phase === 'managed') {
              owner.assertCurrent(attempt)
            }
          },
        }
        launchStarted = true
        owner.beginLaunch(attempt)
        return await scope.run(executionScope, async () => {
          let candidate: LaunchAgentSessionResult
          try {
            candidate = (await execute(context)) as LaunchAgentSessionResult
          } catch (error) {
            if (executionScope.phase !== 'managed') {
              throw error
            }
            // Typed lifecycle failures must never become a generic fallback/settlement.
            if (
              error &&
              typeof error === 'object' &&
              'code' in error &&
              String(error.code).startsWith('agent.managed_launch_')
            ) {
              throw error
            }
            const effectAdmitted = owner.hasEffectAdmission(attempt)
            if (effectAdmitted) {
              await owner.fail(attempt)
            }
            const descriptor = toAppErrorDescriptor(error, 'agent.launch_failed')
            throw createAppError({
              ...descriptor,
              details: {
                ...(descriptor.details && typeof descriptor.details === 'object'
                  ? descriptor.details
                  : {}),
                managedClaudeLaunch: true,
                effectAdmitted,
                phase: scope.getStore()?.spawnStarted ? 'afterSpawn' : 'beforeSpawn',
              },
            })
          }
          if (executionScope.phase === 'legacy') {
            return candidate
          }
          if (candidate.managedClaudeLifecycle) {
            return candidate
          }
          if (
            candidate.executionContext.endpoint.kind === 'remote_worker' ||
            candidate.provider !== 'claude-code'
          ) {
            return candidate
          }
          if (!deps.hasRuntime(candidate.sessionId)) {
            await owner.cleanup(candidate.sessionId)
            rejectManagedLaunch(attempt.nodeId, 'resumeUnavailable')
          }
          const receipt = await owner.complete(attempt, {
            runtimeSessionId: candidate.sessionId,
            tuple: {
              resumeSessionId: candidate.resumeSessionId,
              resumeSessionIdVerified: Boolean(candidate.resumeSessionId),
            },
          })
          return {
            ...candidate,
            resumeSessionId: receipt.binding.tuple.resumeSessionId,
            managedClaudeBinding: receipt.binding,
            managedClaudeLifecycle: receipt,
          }
        })
      } finally {
        try {
          if (launchStarted) {
            await owner.finishLaunch(attempt!)
          }
        } finally {
          releasePending()
        }
      }
    },
  }
}

export function assertManagedClaudeLaunchCurrent(): void {
  const current = scope.getStore()
  if (current?.phase === 'managed') {
    current.owner.assertCurrent(current.attempt)
  }
}

export async function withManagedClaudeFallback<T extends { sessionId: string }>(
  spawn: () => Promise<T>,
): Promise<
  T & {
    managedClaudeLifecycle?: ManagedClaudeLifecycleReceipt
    managedClaudeBinding?: ManagedClaudeBindingObservation
  }
> {
  const current = scope.getStore()
  if (current?.phase !== 'managed') {
    return spawn()
  }
  if (!current.owner.hasEffectAdmission(current.attempt)) {
    const context = current.attempt.context
    const route = context ? (JSON.parse(context.route) as { mountId?: string } | null) : null
    await current.owner.admit(current.attempt, {
      provider: 'claude-code',
      cwd: context?.directory ?? '',
      mountId: route?.mountId ?? null,
    })
  }
  const receipt = await current.owner.fail(current.attempt)
  assertManagedClaudeLaunchCurrent()
  const result = await spawn()
  if (!current.owner.isCurrent(current.attempt)) {
    await current.owner.cleanup(result.sessionId)
    rejectManagedLaunch(current.attempt.nodeId, 'superseded')
  }
  return {
    ...result,
    ...(receipt ? { managedClaudeLifecycle: receipt, managedClaudeBinding: receipt.binding } : {}),
  }
}

export function rethrowManagedClaudeLaunchError(error: unknown): void {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (String(error.code).startsWith('agent.managed_launch_') ||
      (scope.getStore()?.phase === 'managed' && error.code === 'persistence.unavailable') ||
      ('details' in error &&
        error.details &&
        typeof error.details === 'object' &&
        'managedClaudeLaunch' in error.details &&
        error.details.managedClaudeLaunch === true &&
        'effectAdmitted' in error.details &&
        error.details.effectAdmitted === false))
  ) {
    throw error
  }
}

export function assertNoManagedClaudeRemoteLaunch(): void {
  const current = scope.getStore()
  if (current?.phase === 'managed' && current.attempt.expected?.activationId) {
    rejectManagedLaunch(current.attempt.nodeId, 'identityConflict')
  }
  if (current) {
    current.phase = 'legacy'
    current.releasePending?.()
  }
}

export function noteManagedClaudeSpawnStarted(): void {
  const current = scope.getStore()
  if (current?.phase === 'managed') {
    current.owner.assertCurrent(current.attempt)
    current.spawnStarted = true
  }
}

export function noteManagedClaudeRuntimeCreated(id: string): void {
  const current = scope.getStore()
  if (current?.phase === 'managed') {
    current.owner.trackCreatedRuntime(current.attempt, id)
  }
}
