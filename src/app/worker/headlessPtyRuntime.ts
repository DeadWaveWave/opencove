import { randomUUID } from 'node:crypto'
import type {
  AgentProviderId,
  AgentHookInstallState,
  ResizeTerminalInput,
  TerminalForegroundEvent,
  TerminalGeometryCommitResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../shared/contracts/dto'
import {
  createSessionStateWatcherController,
  type SessionStateWatcherStartInput,
} from '../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import { isDebugCrashHostEnabled } from '../../contexts/terminal/presentation/main-ipc/debugCrashHost'
import { TerminalProfileResolver } from '../../platform/terminal/TerminalProfileResolver'
import type { ListTerminalProfilesResult } from '../../shared/contracts/dto'
import { stripAutomaticTerminalQueriesFromOutput } from '../../shared/terminal/automaticTerminalSequences'
import type { TerminalProcessEnginePort } from '../../contexts/terminal/application/ports/TerminalProcessEnginePort'
import {
  SessionRegistrationOwner,
  SessionRegistrationRejectedError,
} from '../../shared/runtime/sessionRegistrationOwner'

type SpawnSessionOptions = {
  cwd: string
  cols: number
  rows: number
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  agentProvider?: AgentProviderId
  initialAgentState?: 'working' | 'standby'
  hookInstallState?: AgentHookInstallState
}

export interface HeadlessPtyRuntime {
  listProfiles: () => Promise<ListTerminalProfilesResult>
  spawnSession: (options: SpawnSessionOptions) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string) => void
  probeForeground: (sessionId: string) => void
  resize: (input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onForeground: (listener: (event: TerminalForegroundEvent) => void) => () => void
  onState: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  startSessionStateWatcher: (input: SessionStateWatcherStartInput) => void
  debugCrashHost?: () => void | Promise<void>
  dispose: () => void
}

export function createHeadlessPtyRuntime(options: {
  processEngine: TerminalProcessEnginePort
}): HeadlessPtyRuntime {
  const { processEngine } = options
  const debugCrashHostEnabled = isDebugCrashHostEnabled()
  const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const foregroundListeners = new Set<(event: TerminalForegroundEvent) => void>()
  const stateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  const profileResolver = new TerminalProfileResolver()
  const hookInstallStateBySessionId = new Map<
    string,
    TerminalSessionStateEvent['hookInstallState']
  >()
  const providerBySessionId = new Map<string, AgentProviderId>()
  const sessionRegistrations = new SessionRegistrationOwner()

  const emitState = (event: TerminalSessionStateEvent): void => {
    stateListeners.forEach(listener => listener(event))
  }

  const sessionStateWatcher = createSessionStateWatcherController({
    sendToAllWindows: () => undefined,
    reportIssue: message => {
      process.stderr.write(`${message}\n`)
    },
    onState: event => {
      emitState({
        ...event,
        source: event.source ?? 'session_file',
        ...(hookInstallStateBySessionId.get(event.sessionId)
          ? { hookInstallState: hookInstallStateBySessionId.get(event.sessionId) }
          : {}),
      })
    },
    onMetadata: event => {
      metadataListeners.forEach(listener => listener(event))
    },
  })

  const disposeDataListener = processEngine.onData(event => {
    const { visibleData, replies } = stripAutomaticTerminalQueriesFromOutput(event.data)
    replies.forEach(reply => {
      processEngine.write(event.sessionId, reply)
    })

    if (visibleData.length === 0) {
      return
    }

    dataListeners.forEach(listener => listener({ ...event, data: visibleData }))
  })

  const disposeExitListener = processEngine.onExit(event => {
    sessionRegistrations.noteCompletion(event.sessionId)
    if (providerBySessionId.get(event.sessionId) === 'codex') {
      emitState({
        sessionId: event.sessionId,
        state: 'standby',
        source: 'codex_hook',
        hookInstallState: hookInstallStateBySessionId.get(event.sessionId),
      })
    }
    sessionStateWatcher.disposeSession(event.sessionId)
    providerBySessionId.delete(event.sessionId)
    hookInstallStateBySessionId.delete(event.sessionId)
    exitListeners.forEach(listener => listener(event))
  })
  const disposeForegroundListener = processEngine.onForeground(event => {
    foregroundListeners.forEach(listener => listener(event))
    if (!event.shellOnly) {
      return
    }
    if (providerBySessionId.get(event.sessionId) !== 'codex') {
      return
    }
    emitState({
      sessionId: event.sessionId,
      state: 'standby',
      source: 'codex_hook',
      hookInstallState: hookInstallStateBySessionId.get(event.sessionId),
    })
  })

  let isDisposed = false

  return {
    listProfiles: async () => await profileResolver.listProfiles(),
    spawnSession: async input => {
      const registration = sessionRegistrations.begin()
      let spawned: { sessionId: string }
      try {
        spawned = await processEngine.spawn(input)
      } catch (error) {
        registration.cancel()
        throw error
      }

      const disposition = registration.complete(spawned.sessionId)
      if (disposition !== 'active') {
        const registrationError = new SessionRegistrationRejectedError(
          spawned.sessionId,
          disposition,
        )
        if (disposition === 'owner_disposed') {
          let cleanupError: unknown = null
          try {
            processEngine.kill(spawned.sessionId)
          } catch (error) {
            cleanupError = error
          }
          if (cleanupError) {
            throw new AggregateError(
              [registrationError, cleanupError],
              '[pty] failed to retire a session returned after headless runtime disposal',
            )
          }
        }
        throw registrationError
      }

      if (input.agentProvider && input.hookInstallState) {
        providerBySessionId.set(spawned.sessionId, input.agentProvider)
        hookInstallStateBySessionId.set(spawned.sessionId, input.hookInstallState)
        emitState({
          sessionId: spawned.sessionId,
          state: input.initialAgentState ?? 'working',
          source: 'launch',
          hookInstallState: input.hookInstallState,
        })
      }
      return spawned
    },
    write: (sessionId, data) => {
      processEngine.write(sessionId, data)
      sessionStateWatcher.noteInteraction(sessionId, data)
    },
    probeForeground: sessionId => {
      processEngine.probeForeground(sessionId)
    },
    resize: async input => {
      const operationId = input.operationId?.trim() || randomUUID()
      try {
        const appliedGeometry = await processEngine.resize(input.sessionId, input.cols, input.rows)
        if (appliedGeometry.status === 'applied_unverified') {
          return {
            sessionId: input.sessionId,
            operationId,
            status: 'accepted_unverified',
            changed: false,
            geometry: null,
            authority: null,
          }
        }
        return {
          sessionId: input.sessionId,
          operationId,
          status: 'accepted',
          changed: true,
          geometry: {
            cols: appliedGeometry.cols,
            rows: appliedGeometry.rows,
            revision: null,
          },
          authority: null,
        }
      } catch {
        return {
          sessionId: input.sessionId,
          operationId,
          status: 'runtime_failed',
          changed: false,
          geometry: null,
          authority: null,
        }
      }
    },
    kill: sessionId => {
      sessionStateWatcher.disposeSession(sessionId)
      providerBySessionId.delete(sessionId)
      hookInstallStateBySessionId.delete(sessionId)
      processEngine.kill(sessionId)
    },
    onData: listener => {
      dataListeners.add(listener)
      return () => {
        dataListeners.delete(listener)
      }
    },
    onExit: listener => {
      exitListeners.add(listener)
      return () => {
        exitListeners.delete(listener)
      }
    },
    onForeground: listener => {
      foregroundListeners.add(listener)
      return () => {
        foregroundListeners.delete(listener)
      }
    },
    onState: listener => {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    },
    onMetadata: listener => {
      metadataListeners.add(listener)
      return () => {
        metadataListeners.delete(listener)
      }
    },
    startSessionStateWatcher: input => {
      sessionStateWatcher.start(input)
    },
    disposeSessionStateWatcher: sessionId => {
      sessionStateWatcher.disposeSession(sessionId)
    },
    ...(debugCrashHostEnabled
      ? {
          debugCrashHost: async () => {
            await processEngine.crashForDebug?.()
          },
        }
      : {}),
    dispose: () => {
      if (isDisposed) {
        return
      }
      isDisposed = true

      disposeDataListener()
      disposeExitListener()
      disposeForegroundListener()
      dataListeners.clear()
      exitListeners.clear()
      foregroundListeners.clear()
      stateListeners.clear()
      metadataListeners.clear()
      hookInstallStateBySessionId.clear()
      providerBySessionId.clear()
      sessionRegistrations.dispose()
      sessionStateWatcher.dispose()
      processEngine.dispose()
    },
  }
}
