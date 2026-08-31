import type {
  HomeWorkerConfigFile,
  HomeWorkerWebUiConfigFile,
} from '../../contexts/settings/infrastructure/homeWorker/homeWorkerConfig'
import type {
  ControlSurfaceHttpListener,
  ControlSurfaceHttpListenerAddress,
  ControlSurfaceHttpRuntime,
} from '../main/controlSurface/controlSurfaceHttpRuntime.contract'

const DEFAULT_DRAIN_TIMEOUT_MS = 30_000

export type WorkerWebAccessRuntimeStatus =
  | {
      state: 'disabled'
      generation: number
      drainingGenerations: number[]
    }
  | {
      state: 'active'
      generation: number
      address: ControlSurfaceHttpListenerAddress
      passwordRequired: boolean
      drainingGenerations: number[]
    }
  | {
      state: 'failed'
      generation: number
      error: string
      drainingGenerations: number[]
    }

export interface WorkerWebAccessRuntime {
  ready: Promise<WorkerWebAccessRuntimeStatus>
  status: () => WorkerWebAccessRuntimeStatus
  apply: (input: {
    next: HomeWorkerConfigFile
    expectedUpdatedAt: string | null
  }) => Promise<{ config: HomeWorkerConfigFile; status: WorkerWebAccessRuntimeStatus }>
  dispose: () => Promise<void>
}

type ActiveWebListener = {
  generation: number
  config: HomeWorkerWebUiConfigFile
  listener: ControlSurfaceHttpListener
  address: ControlSurfaceHttpListenerAddress
}

type PersistWebConfig = (input: {
  next: HomeWorkerConfigFile
  expectedUpdatedAt: string | null
}) => Promise<HomeWorkerConfigFile>

function webConfigsEqual(a: HomeWorkerWebUiConfigFile, b: HomeWorkerWebUiConfigFile): boolean {
  return (
    a.enabled === b.enabled &&
    a.port === b.port &&
    a.exposeOnLan === b.exposeOnLan &&
    a.passwordHash === b.passwordHash
  )
}

function resolveBindHostname(config: HomeWorkerWebUiConfigFile): string {
  return config.exposeOnLan ? '0.0.0.0' : '127.0.0.1'
}

function resolvePasswordHash(config: HomeWorkerWebUiConfigFile): string | null {
  return config.exposeOnLan ? config.passwordHash : null
}

export function createWorkerWebAccessRuntime(options: {
  controlSurfaceRuntime: ControlSurfaceHttpRuntime
  initialConfig: HomeWorkerConfigFile
  persist: PersistWebConfig
  drainTimeoutMs?: number
}): WorkerWebAccessRuntime {
  const drainTimeoutMs = options.drainTimeoutMs ?? DEFAULT_DRAIN_TIMEOUT_MS
  let currentConfig = options.initialConfig
  let active: ActiveWebListener | null = null
  let generation = 0
  let disposed = false
  let applyQueue = Promise.resolve()
  let lastFailure: string | null = null
  const drainingTimers = new Map<number, ReturnType<typeof setTimeout>>()
  const clearDrainingTimers = (): void => {
    for (const timer of drainingTimers.values()) {
      clearTimeout(timer)
    }
    drainingTimers.clear()
  }

  const status = (): WorkerWebAccessRuntimeStatus => {
    const drainingGenerations = [...drainingTimers.keys()].sort((a, b) => a - b)
    if (active) {
      return {
        state: 'active',
        generation: active.generation,
        address: { ...active.address },
        passwordRequired: Boolean(resolvePasswordHash(active.config)),
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
  }): Promise<ActiveWebListener> => {
    const listener = options.controlSurfaceRuntime.listen({
      hostname: '127.0.0.1',
      bindHostname: resolveBindHostname(input.config),
      port: input.port,
      role: 'web',
      enableWebShell: true,
      webUiPasswordHash: resolvePasswordHash(input.config),
      startGated: true,
      webAccessGeneration: input.generation,
    })
    try {
      const address = await listener.ready
      return { generation: input.generation, config: input.config, listener, address }
    } catch (error) {
      await listener.dispose().catch(() => undefined)
      throw error
    }
  }

  const activate = (candidate: ActiveWebListener): void => {
    candidate.listener.activate()
    active = candidate
    generation = candidate.generation
    lastFailure = null
    options.controlSurfaceRuntime.setWebAccessPolicy({
      enabled: true,
      passwordRequired: Boolean(resolvePasswordHash(candidate.config)),
    })
  }

  const scheduleDrain = (retired: ActiveWebListener): void => {
    if (drainingTimers.has(retired.generation)) {
      return
    }
    const timer = setTimeout(() => {
      drainingTimers.delete(retired.generation)
      options.controlSurfaceRuntime.closePtyStreamClients({
        listenerRole: 'web',
        webAccessGeneration: retired.generation,
      })
    }, drainTimeoutMs)
    timer.unref?.()
    drainingTimers.set(retired.generation, timer)
  }

  const restorePreviousListener = async (previous: ActiveWebListener): Promise<void> => {
    const restored = await createListener({
      config: previous.config,
      generation: previous.generation,
      port: previous.address.port,
    })
    activate(restored)
  }

  const enterFailedClosedState = (rollbackError: unknown): Error => {
    const error = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError))
    active = null
    lastFailure = `Web listener rollback failed: ${error.message}`
    options.controlSurfaceRuntime.setWebAccessPolicy({
      enabled: false,
      passwordRequired: false,
    })
    options.controlSurfaceRuntime.rotateWebSessionGeneration()
    options.controlSurfaceRuntime.closePtyStreamClients({ listenerRole: 'web' })
    clearDrainingTimers()
    return error
  }

  const revokeForSecurityTransition = (
    previous: ActiveWebListener,
    next: HomeWorkerWebUiConfigFile,
  ): void => {
    const previousPassword = resolvePasswordHash(previous.config)
    const nextPassword = resolvePasswordHash(next)
    if (previousPassword !== nextPassword) {
      const rotation = options.controlSurfaceRuntime.rotateWebSessionGeneration()
      options.controlSurfaceRuntime.closePtyStreamClients({
        webSessionGeneration: rotation.previousGeneration,
      })
    }
    if (previous.config.exposeOnLan && !next.exposeOnLan) {
      options.controlSurfaceRuntime.closePtyStreamClients({
        listenerRole: 'web',
        nonLoopbackOnly: true,
      })
    }
  }

  const applyEnabled = async (input: {
    next: HomeWorkerConfigFile
    expectedUpdatedAt: string | null
  }): Promise<{ config: HomeWorkerConfigFile; status: WorkerWebAccessRuntimeStatus }> => {
    const previous = active
    const targetPort =
      input.next.webUi.port ??
      (previous && currentConfig.webUi.port === null ? previous.address.port : 0)
    const samePort = previous !== null && targetPort === previous.address.port
    if (samePort) {
      await previous.listener.stopAccepting()
    }

    const candidateGeneration = generation + 1
    let candidate: ActiveWebListener
    try {
      candidate = await createListener({
        config: input.next.webUi,
        generation: candidateGeneration,
        port: targetPort,
      })
    } catch (error) {
      if (samePort && previous) {
        try {
          await restorePreviousListener(previous)
        } catch (rollbackError) {
          throw enterFailedClosedState(rollbackError)
        }
      }
      throw error
    }

    let persisted: HomeWorkerConfigFile
    try {
      persisted = await options.persist(input)
    } catch (error) {
      await candidate.listener.dispose().catch(() => undefined)
      if (samePort && previous) {
        try {
          await restorePreviousListener(previous)
        } catch (rollbackError) {
          throw enterFailedClosedState(rollbackError)
        }
      }
      throw error
    }

    activate({ ...candidate, config: persisted.webUi })
    currentConfig = persisted
    if (previous) {
      if (!samePort) {
        await previous.listener.stopAccepting()
      }
      revokeForSecurityTransition(previous, persisted.webUi)
      scheduleDrain(previous)
    }
    return { config: persisted, status: status() }
  }

  const applyDisabled = async (input: {
    next: HomeWorkerConfigFile
    expectedUpdatedAt: string | null
  }): Promise<{ config: HomeWorkerConfigFile; status: WorkerWebAccessRuntimeStatus }> => {
    const persisted = await options.persist(input)
    const previous = active
    currentConfig = persisted
    active = null
    lastFailure = null
    options.controlSurfaceRuntime.setWebAccessPolicy({ enabled: false, passwordRequired: false })
    if (previous) {
      await previous.listener.stopAccepting()
    }
    options.controlSurfaceRuntime.rotateWebSessionGeneration()
    options.controlSurfaceRuntime.closePtyStreamClients({ listenerRole: 'web' })
    clearDrainingTimers()
    return { config: persisted, status: status() }
  }

  const initialize = async (): Promise<WorkerWebAccessRuntimeStatus> => {
    if (!currentConfig.webUi.enabled) {
      options.controlSurfaceRuntime.setWebAccessPolicy({ enabled: false, passwordRequired: false })
      return status()
    }
    try {
      const candidate = await createListener({
        config: currentConfig.webUi,
        generation: 1,
        port: currentConfig.webUi.port ?? 0,
      })
      activate(candidate)
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error)
      options.controlSurfaceRuntime.setWebAccessPolicy({ enabled: false, passwordRequired: false })
    }
    return status()
  }

  // Defer listener creation so Worker composition can register private administrative handlers
  // before any HTTP listener begins accepting traffic.
  const ready = Promise.resolve().then(initialize)

  return {
    ready,
    status,
    apply: input => {
      const operation = applyQueue.then(async () => {
        await ready
        if (disposed) {
          throw new Error('Worker Web access runtime is disposed.')
        }
        const runtimeMatchesDesiredState = input.next.webUi.enabled
          ? active !== null
          : active === null && lastFailure === null
        if (
          runtimeMatchesDesiredState &&
          webConfigsEqual(currentConfig.webUi, input.next.webUi) &&
          currentConfig.updatedAt === input.expectedUpdatedAt
        ) {
          return { config: currentConfig, status: status() }
        }
        return input.next.webUi.enabled ? await applyEnabled(input) : await applyDisabled(input)
      })
      applyQueue = operation.then(
        () => undefined,
        () => undefined,
      )
      return operation
    },
    dispose: async () => {
      disposed = true
      await applyQueue
      clearDrainingTimers()
      const current = active
      active = null
      if (current) {
        await current.listener.stopAccepting()
        options.controlSurfaceRuntime.closePtyStreamClients({ listenerRole: 'web' })
      }
    },
  }
}
