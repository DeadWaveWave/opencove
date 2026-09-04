import type { HomeWorkerConfigFile, HomeWorkerWebUiConfigFile } from '../../domain/homeWorkerConfig'
import { createSerialOperationQueue } from '@shared/runtime/serialOperationQueue'
import type {
  ActiveWebListener,
  DegradedWebListener,
  PersistWebConfig,
  WorkerWebAccessPort,
  WorkerWebAccessRuntime,
  WorkerWebListener,
  WorkerWebAccessRuntimeStatus,
} from './workerWebAccessTypes'
import {
  DEFAULT_WEB_LISTENER_DRAIN_TIMEOUT_MS,
  MAX_WEB_LISTENER_RESTORE_DELAY_MS,
  resolveWebBindHostname,
  resolveWebPasswordHash,
  toWebAccessError,
  waitForWebAccessRestore,
  webConfigsEqual,
} from './workerWebAccessPolicy'

export function createWorkerWebAccessOwner(options: {
  runtime: WorkerWebAccessPort
  initialConfig: HomeWorkerConfigFile
  persist: PersistWebConfig
  drainTimeoutMs?: number
}): WorkerWebAccessRuntime {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_WEB_LISTENER_DRAIN_TIMEOUT_MS
  let currentConfig = options.initialConfig
  let active: ActiveWebListener | null = null
  let degraded: DegradedWebListener | null = null
  let generation = 0
  let lifecycleEpoch = 0
  let disposed = false
  let disposePromise: Promise<void> | null = null
  const applyOperations = createSerialOperationQueue()
  let lastFailure: string | null = null
  let recoveryAbort: AbortController | null = null
  let recoveryPromise: Promise<void> | null = null
  const pendingListeners = new Set<WorkerWebListener>()
  const drainingTimers = new Map<
    number,
    { timer: ReturnType<typeof setTimeout>; retired: ActiveWebListener }
  >()
  const preservedStreamTimers = new Map<WorkerWebListener, ReturnType<typeof setTimeout>>()

  const clearPreservedStreamTimers = (): void => {
    for (const [listener, timer] of preservedStreamTimers) {
      clearTimeout(timer)
      listener.closeStreamingClients()
    }
    preservedStreamTimers.clear()
  }

  const clearDrainingTimers = (): void => {
    for (const { timer, retired } of drainingTimers.values()) {
      clearTimeout(timer)
      retired.listener.closeStreamingClients()
    }
    drainingTimers.clear()
    clearPreservedStreamTimers()
  }

  const status = (): WorkerWebAccessRuntimeStatus => {
    const drainingGenerations = [...drainingTimers.keys()].sort((a, b) => a - b)
    if (degraded) {
      return {
        state: 'degraded',
        generation: degraded.previous.generation,
        address: { ...degraded.previous.address },
        passwordRequired: Boolean(resolveWebPasswordHash(degraded.previous.config)),
        error: degraded.error,
        drainingGenerations,
      }
    }
    if (active) {
      return {
        state: 'active',
        generation: active.generation,
        address: { ...active.address },
        passwordRequired: Boolean(resolveWebPasswordHash(active.config)),
        drainingGenerations,
      }
    }
    if (lastFailure) {
      return { state: 'failed', generation, error: lastFailure, drainingGenerations }
    }
    return { state: 'disabled', generation, drainingGenerations }
  }

  const createListener = async (input: {
    config: HomeWorkerWebUiConfigFile
    generation: number
    port: number
    expectedEpoch: number
    signal?: AbortSignal
  }): Promise<ActiveWebListener> => {
    if (disposed || input.expectedEpoch !== lifecycleEpoch || input.signal?.aborted) {
      throw new Error('Worker Web access listener transition was cancelled.')
    }
    const listener = options.runtime.listen({
      hostname: '127.0.0.1',
      bindHostname: resolveWebBindHostname(input.config),
      port: input.port,
      role: 'web',
      enableWebShell: true,
      webUiPasswordHash: resolveWebPasswordHash(input.config),
      startGated: true,
      webAccessGeneration: input.generation,
    })
    pendingListeners.add(listener)
    const stopOnAbort = (): void => {
      void listener.stopAccepting().catch(() => undefined)
    }
    input.signal?.addEventListener('abort', stopOnAbort, { once: true })
    try {
      const address = await listener.ready
      if (disposed || input.expectedEpoch !== lifecycleEpoch || input.signal?.aborted) {
        await listener.stopAccepting().catch(() => undefined)
        throw new Error('Worker Web access listener transition was cancelled.')
      }
      return { generation: input.generation, config: input.config, listener, address }
    } catch (error) {
      await listener.dispose().catch(() => undefined)
      throw error
    } finally {
      input.signal?.removeEventListener('abort', stopOnAbort)
      pendingListeners.delete(listener)
    }
  }

  const activate = (candidate: ActiveWebListener): void => {
    if (disposed) {
      void candidate.listener.stopAccepting().catch(() => undefined)
      return
    }
    candidate.listener.activate()
    active = candidate
    degraded = null
    generation = candidate.generation
    lastFailure = null
    options.runtime.setWebAccessPolicy({
      enabled: true,
      passwordRequired: Boolean(resolveWebPasswordHash(candidate.config)),
    })
  }

  const scheduleDrain = (retired: ActiveWebListener): void => {
    if (drainingTimers.has(retired.generation)) {
      return
    }
    const timer = setTimeout(() => {
      drainingTimers.delete(retired.generation)
      retired.listener.closeStreamingClients()
      options.runtime.closePtyStreamClients({
        listenerRole: 'web',
        webAccessGeneration: retired.generation,
      })
    }, drainTimeoutMs)
    drainingTimers.set(retired.generation, { timer, retired })
  }

  const schedulePreservedStreamDrain = (listener: WorkerWebListener): void => {
    if (preservedStreamTimers.has(listener)) {
      return
    }
    const timer = setTimeout(() => {
      preservedStreamTimers.delete(listener)
      listener.closeStreamingClients()
    }, drainTimeoutMs)
    preservedStreamTimers.set(listener, timer)
  }

  const revokeForSecurityTransition = (
    previous: ActiveWebListener,
    next: HomeWorkerWebUiConfigFile,
  ): void => {
    const previousPassword = resolveWebPasswordHash(previous.config)
    const nextPassword = resolveWebPasswordHash(next)
    if (previousPassword !== nextPassword) {
      clearPreservedStreamTimers()
      previous.listener.closeStreamingClients()
      const rotation = options.runtime.rotateWebSessionGeneration()
      options.runtime.closePtyStreamClients({
        webSessionGeneration: rotation.previousGeneration,
      })
    }
    if (previous.config.exposeOnLan && !next.exposeOnLan) {
      previous.listener.closeStreamingClients()
      options.runtime.closePtyStreamClients({
        listenerRole: 'web',
        nonLoopbackOnly: true,
      })
    }
  }

  const cancelRecovery = async (): Promise<void> => {
    recoveryAbort?.abort()
    recoveryAbort = null
    await recoveryPromise?.catch(() => undefined)
    recoveryPromise = null
  }

  const startRecovery = (previous: ActiveWebListener, initialError: Error, epoch: number): void => {
    const abort = new AbortController()
    recoveryAbort = abort
    degraded = {
      previous,
      error: `Web listener rollback failed: ${initialError.message}`,
    }
    active = previous
    lastFailure = null
    options.runtime.setWebAccessPolicy({
      enabled: true,
      passwordRequired: Boolean(resolveWebPasswordHash(previous.config)),
    })

    const operation = (async () => {
      let delayMs = 250
      /* eslint-disable no-await-in-loop, no-unmodified-loop-condition -- restoration is one cancellable sequential backoff */
      while (!disposed && !abort.signal.aborted && epoch === lifecycleEpoch) {
        if (!(await waitForWebAccessRestore(abort.signal, delayMs))) {
          return
        }
        try {
          const restored = await createListener({
            config: previous.config,
            generation: previous.generation,
            port: previous.address.port,
            expectedEpoch: epoch,
            signal: abort.signal,
          })
          if (disposed || abort.signal.aborted || epoch !== lifecycleEpoch) {
            await restored.listener.stopAccepting().catch(() => undefined)
            return
          }
          activate(restored)
          schedulePreservedStreamDrain(previous.listener)
          return
        } catch (error) {
          if (disposed || abort.signal.aborted || epoch !== lifecycleEpoch) {
            return
          }
          degraded = {
            previous,
            error: `Web listener rollback failed: ${toWebAccessError(error).message}`,
          }
          delayMs = Math.min(delayMs * 2, MAX_WEB_LISTENER_RESTORE_DELAY_MS)
        }
      }
      /* eslint-enable no-await-in-loop, no-unmodified-loop-condition */
    })()
    const tracked = operation.finally(() => {
      if (recoveryAbort === abort) {
        recoveryAbort = null
      }
      if (recoveryPromise === tracked) {
        recoveryPromise = null
      }
    })
    recoveryPromise = tracked
  }

  const restorePreviousListener = async (
    previous: ActiveWebListener,
    expectedEpoch: number,
  ): Promise<void> => {
    const restored = await createListener({
      config: previous.config,
      generation: previous.generation,
      port: previous.address.port,
      expectedEpoch,
    })
    activate(restored)
    schedulePreservedStreamDrain(previous.listener)
  }

  const applyEnabled = async (input: {
    next: HomeWorkerConfigFile
    expectedUpdatedAt: string | null
    expectedEpoch: number
  }): Promise<{ config: HomeWorkerConfigFile; status: WorkerWebAccessRuntimeStatus }> => {
    const previous = active
    const targetPort =
      input.next.webUi.port ??
      (previous && currentConfig.webUi.port === null ? previous.address.port : 0)
    const sameEndpoint =
      previous !== null &&
      degraded === null &&
      targetPort === previous.address.port &&
      resolveWebBindHostname(input.next.webUi) === previous.address.bindHostname

    if (sameEndpoint && previous) {
      const persisted = await options.persist(input)
      if (disposed || input.expectedEpoch !== lifecycleEpoch) {
        throw new Error('Worker Web access runtime is disposed.')
      }
      const nextPasswordHash = resolveWebPasswordHash(persisted.webUi)
      previous.listener.updateWebUiPasswordHash(nextPasswordHash)
      revokeForSecurityTransition(previous, persisted.webUi)
      active = { ...previous, config: persisted.webUi }
      currentConfig = persisted
      options.runtime.setWebAccessPolicy({
        enabled: true,
        passwordRequired: Boolean(nextPasswordHash),
      })
      return { config: persisted, status: status() }
    }

    const samePort = previous !== null && targetPort === previous.address.port
    if (samePort && previous) {
      await previous.listener.stopAccepting({
        preserveStreamingClients: true,
        drainTimeoutMs,
      })
    }

    const candidateGeneration = generation + 1
    let candidate: ActiveWebListener
    try {
      candidate = await createListener({
        config: input.next.webUi,
        generation: candidateGeneration,
        port: targetPort,
        expectedEpoch: input.expectedEpoch,
      })
    } catch (error) {
      if (samePort && previous && !disposed && input.expectedEpoch === lifecycleEpoch) {
        try {
          await restorePreviousListener(previous, input.expectedEpoch)
        } catch (rollbackError) {
          const resolvedRollbackError = toWebAccessError(rollbackError)
          startRecovery(previous, resolvedRollbackError, input.expectedEpoch)
          throw resolvedRollbackError
        }
      }
      throw error
    }

    let persisted: HomeWorkerConfigFile
    try {
      persisted = await options.persist(input)
    } catch (error) {
      await candidate.listener.dispose().catch(() => undefined)
      if (samePort && previous && !disposed && input.expectedEpoch === lifecycleEpoch) {
        try {
          await restorePreviousListener(previous, input.expectedEpoch)
        } catch (rollbackError) {
          const resolvedRollbackError = toWebAccessError(rollbackError)
          startRecovery(previous, resolvedRollbackError, input.expectedEpoch)
          throw resolvedRollbackError
        }
      }
      throw error
    }

    if (disposed || input.expectedEpoch !== lifecycleEpoch) {
      await candidate.listener.dispose().catch(() => undefined)
      throw new Error('Worker Web access runtime is disposed.')
    }
    activate({ ...candidate, config: persisted.webUi })
    currentConfig = persisted
    if (previous) {
      revokeForSecurityTransition(previous, persisted.webUi)
      if (!samePort) {
        await previous.listener.stopAccepting({
          preserveStreamingClients: true,
          drainTimeoutMs,
        })
      }
      scheduleDrain(previous)
    }
    return { config: persisted, status: status() }
  }

  const applyDisabled = async (input: {
    next: HomeWorkerConfigFile
    expectedUpdatedAt: string | null
    expectedEpoch: number
  }): Promise<{ config: HomeWorkerConfigFile; status: WorkerWebAccessRuntimeStatus }> => {
    const persisted = await options.persist(input)
    if (disposed || input.expectedEpoch !== lifecycleEpoch) {
      throw new Error('Worker Web access runtime is disposed.')
    }
    const previous = active
    currentConfig = persisted
    active = null
    degraded = null
    lastFailure = null
    options.runtime.setWebAccessPolicy({ enabled: false, passwordRequired: false })
    const stopping = previous?.listener.stopAccepting({ drainTimeoutMs: 0 })
    previous?.listener.closeStreamingClients()
    options.runtime.rotateWebSessionGeneration()
    options.runtime.closePtyStreamClients({ listenerRole: 'web' })
    clearDrainingTimers()
    await stopping
    return { config: persisted, status: status() }
  }

  const initialize = async (): Promise<WorkerWebAccessRuntimeStatus> => {
    if (!currentConfig.webUi.enabled) {
      if (!disposed) {
        options.runtime.setWebAccessPolicy({
          enabled: false,
          passwordRequired: false,
        })
      }
      return status()
    }
    const expectedEpoch = lifecycleEpoch
    try {
      const candidate = await createListener({
        config: currentConfig.webUi,
        generation: 1,
        port: currentConfig.webUi.port ?? 0,
        expectedEpoch,
      })
      if (!disposed && expectedEpoch === lifecycleEpoch) {
        activate(candidate)
      } else {
        await candidate.listener.stopAccepting().catch(() => undefined)
      }
    } catch (error) {
      if (!disposed && expectedEpoch === lifecycleEpoch) {
        lastFailure = toWebAccessError(error).message
        options.runtime.setWebAccessPolicy({
          enabled: false,
          passwordRequired: false,
        })
      }
    }
    return status()
  }

  // Defer admission until Worker composition registers private administrative handlers.
  const ready = Promise.resolve().then(initialize)

  return {
    ready,
    status,
    apply: input =>
      applyOperations.run(async () => {
        await ready
        if (disposed) {
          throw new Error('Worker Web access runtime is disposed.')
        }
        await cancelRecovery()
        lifecycleEpoch += 1
        const expectedEpoch = lifecycleEpoch
        const runtimeMatchesDesiredState = input.next.webUi.enabled
          ? active !== null && degraded === null
          : active === null && lastFailure === null
        if (
          runtimeMatchesDesiredState &&
          webConfigsEqual(currentConfig.webUi, input.next.webUi) &&
          currentConfig.updatedAt === input.expectedUpdatedAt
        ) {
          return { config: currentConfig, status: status() }
        }
        return input.next.webUi.enabled
          ? await applyEnabled({ ...input, expectedEpoch })
          : await applyDisabled({ ...input, expectedEpoch })
      }),
    dispose: async () => {
      if (disposePromise) {
        return await disposePromise
      }
      disposed = true
      lifecycleEpoch += 1
      recoveryAbort?.abort()
      const pendingStops = [...pendingListeners].map(async listener => {
        await listener.stopAccepting({ drainTimeoutMs: 0 }).catch(() => undefined)
      })
      disposePromise = (async () => {
        await Promise.allSettled([
          ready,
          applyOperations.whenIdle(),
          recoveryPromise,
          ...pendingStops,
        ])
        clearDrainingTimers()
        const current = active
        active = null
        degraded = null
        lastFailure = null
        if (current) {
          await current.listener.stopAccepting({ drainTimeoutMs: 0 }).catch(() => undefined)
          current.listener.closeStreamingClients()
          options.runtime.closePtyStreamClients({ listenerRole: 'web' })
        }
        options.runtime.setWebAccessPolicy({
          enabled: false,
          passwordRequired: false,
        })
      })()
      return await disposePromise
    },
  }
}
