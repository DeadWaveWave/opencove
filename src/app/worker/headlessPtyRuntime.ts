import { fork } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { PtyHostSupervisor } from '../../platform/process/ptyHost/supervisor'
import { createNodeChildPtyHostProcess } from '../../platform/process/ptyHost/nodeProcessAdapter'
import type {
  AgentProviderId,
  ResizeTerminalInput,
  TerminalGeometryCommitResult,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
} from '../../shared/contracts/dto'
import type { AgentHookChannel } from '../../shared/runtime/agentHook/agentHookChannel'
import {
  createSessionStateWatcherController,
  type SessionStateWatcherStartInput,
} from '../../contexts/terminal/presentation/main-ipc/sessionStateWatcher'
import { isDebugCrashHostEnabled } from '../../contexts/terminal/presentation/main-ipc/debugCrashHost'
import { TerminalProfileResolver } from '../../platform/terminal/TerminalProfileResolver'
import type { ListTerminalProfilesResult } from '../../shared/contracts/dto'
import { stripAutomaticTerminalQueriesFromOutput } from '../../shared/terminal/automaticTerminalSequences'
import { cleanAgentHookRuntimeEnv } from '../../shared/runtime/codexHookRuntime'

type SpawnSessionOptions = {
  cwd: string
  cols: number
  rows: number
  command: string
  args: string[]
  env?: NodeJS.ProcessEnv
  agentProvider?: AgentProviderId
  initialAgentState?: 'working' | 'standby'
}

export interface HeadlessPtyRuntime {
  listProfiles: () => Promise<ListTerminalProfilesResult>
  spawnSession: (options: SpawnSessionOptions) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string) => void
  resize: (input: ResizeTerminalInput) => Promise<TerminalGeometryCommitResult>
  kill: (sessionId: string) => void
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onState: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  startSessionStateWatcher: (input: SessionStateWatcherStartInput) => void
  debugCrashHost?: () => void
  dispose: () => void
}

export function createHeadlessPtyRuntime(options: {
  userDataPath: string
  agentHookChannels?: Partial<Record<AgentProviderId, AgentHookChannel>>
}): HeadlessPtyRuntime {
  const logsDir = resolve(options.userDataPath, 'logs')
  const logFilePath = resolve(logsDir, 'pty-host.log')
  const debugCrashHostEnabled = isDebugCrashHostEnabled()
  const dataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const exitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const stateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const metadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()
  const profileResolver = new TerminalProfileResolver()
  const hookInstallStateBySessionId = new Map<
    string,
    TerminalSessionStateEvent['hookInstallState']
  >()
  const hookChannelsBySessionId = new Map<string, AgentHookChannel[]>()
  const agentHookChannels = options.agentHookChannels ?? {}

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
        source: 'session_file',
        ...(hookInstallStateBySessionId.get(event.sessionId)
          ? { hookInstallState: hookInstallStateBySessionId.get(event.sessionId) }
          : {}),
      })
    },
    onMetadata: event => {
      metadataListeners.forEach(listener => listener(event))
    },
  })

  const disposeHookStateListeners = Object.values(agentHookChannels).map(channel =>
    channel.onState(emitState),
  )

  const supervisor = new PtyHostSupervisor({
    baseDir: __dirname,
    logFilePath,
    createProcess: modulePath => {
      const child = fork(modulePath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env },
      })
      return createNodeChildPtyHostProcess(child)
    },
  })

  const disposeDataListener = supervisor.onData(event => {
    const { visibleData, replies } = stripAutomaticTerminalQueriesFromOutput(event.data)
    replies.forEach(reply => {
      supervisor.write(event.sessionId, reply)
    })

    if (visibleData.length === 0) {
      return
    }

    dataListeners.forEach(listener => listener({ ...event, data: visibleData }))
  })

  const disposeExitListener = supervisor.onExit(event => {
    const codexHookChannel = agentHookChannels.codex
    if (
      codexHookChannel &&
      hookChannelsBySessionId.get(event.sessionId)?.includes(codexHookChannel)
    ) {
      emitState({
        sessionId: event.sessionId,
        state: 'standby',
        source: 'codex_hook',
        hookInstallState: codexHookChannel.getInstallState(),
      })
    }
    sessionStateWatcher.disposeSession(event.sessionId)
    hookChannelsBySessionId
      .get(event.sessionId)
      ?.forEach(channel => channel.disposeSession(event.sessionId))
    hookChannelsBySessionId.delete(event.sessionId)
    hookInstallStateBySessionId.delete(event.sessionId)
    exitListeners.forEach(listener => listener(event))
  })
  const disposeForegroundListener =
    supervisor.onForeground?.(event => {
      if (!event.shellOnly) {
        return
      }
      const codexHookChannel = agentHookChannels.codex
      if (
        !codexHookChannel ||
        !hookChannelsBySessionId.get(event.sessionId)?.includes(codexHookChannel)
      ) {
        return
      }
      emitState({
        sessionId: event.sessionId,
        state: 'standby',
        source: 'codex_hook',
        hookInstallState: codexHookChannel.getInstallState(),
      })
    }) ?? (() => undefined)

  return {
    listProfiles: async () => await profileResolver.listProfiles(),
    spawnSession: async input => {
      const codexHookChannel = agentHookChannels.codex
      const providerHookChannel = input.agentProvider
        ? agentHookChannels[input.agentProvider]
        : undefined
      const paneIdentity = {
        paneKey: randomUUID(),
        tabId: randomUUID(),
        worktreeId: input.cwd,
      }
      const codexReservation = await codexHookChannel?.reserveSpawn(paneIdentity)
      const providerReservation =
        providerHookChannel && providerHookChannel !== codexHookChannel
          ? await providerHookChannel.reserveSpawn()
          : undefined
      const reservations = [codexReservation, providerReservation].filter(
        (reservation): reservation is NonNullable<typeof reservation> => !!reservation,
      )
      try {
        const reservationEnv = Object.assign({}, ...reservations.map(item => item.env ?? {}))
        const spawned = await supervisor.spawn({
          ...input,
          env: { ...cleanAgentHookRuntimeEnv(input.env ?? {}), ...reservationEnv },
        })
        if (reservations.length > 0) {
          hookChannelsBySessionId.set(spawned.sessionId, [
            ...new Set([codexHookChannel, providerHookChannel].filter(Boolean)),
          ] as AgentHookChannel[])
          if (input.agentProvider && providerHookChannel) {
            const installState =
              providerHookChannel === codexHookChannel
                ? codexReservation?.installState
                : providerReservation?.installState
            if (installState) {
              hookInstallStateBySessionId.set(spawned.sessionId, installState)
            }
            emitState({
              sessionId: spawned.sessionId,
              state: input.initialAgentState ?? 'working',
              source: 'launch',
              hookInstallState: installState,
            })
          }
          reservations.forEach(reservation => reservation.commit(spawned.sessionId))
        }
        return spawned
      } catch (error) {
        reservations.forEach(reservation => reservation.dispose())
        throw error
      }
    },
    write: (sessionId, data) => {
      supervisor.write(sessionId, data)
      sessionStateWatcher.noteInteraction(sessionId, data)
    },
    resize: async input => {
      const operationId = input.operationId?.trim() || randomUUID()
      try {
        const appliedGeometry = await supervisor.resize(input.sessionId, input.cols, input.rows)
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
      hookChannelsBySessionId.get(sessionId)?.forEach(channel => channel.disposeSession(sessionId))
      hookChannelsBySessionId.delete(sessionId)
      hookInstallStateBySessionId.delete(sessionId)
      supervisor.kill(sessionId)
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
          debugCrashHost: () => {
            supervisor.crash()
          },
        }
      : {}),
    dispose: () => {
      disposeDataListener()
      disposeExitListener()
      disposeForegroundListener()
      disposeHookStateListeners.forEach(disposeListener => disposeListener())
      dataListeners.clear()
      exitListeners.clear()
      stateListeners.clear()
      metadataListeners.clear()
      hookInstallStateBySessionId.clear()
      hookChannelsBySessionId.forEach((channels, sessionId) =>
        channels.forEach(channel => channel.disposeSession(sessionId)),
      )
      hookChannelsBySessionId.clear()
      sessionStateWatcher.dispose()
      supervisor.dispose()
    },
  }
}
