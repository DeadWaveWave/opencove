import { app, utilityProcess, webContents } from 'electron'
import process from 'node:process'
import { resolve } from 'node:path'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  AgentLaunchMode,
  AgentProviderId,
  ListTerminalProfilesResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'
import {
  appendSnapshotData,
  createEmptySnapshotState,
  snapshotToString,
} from '../../../../platform/process/pty/snapshot'
import type { SnapshotState } from '../../../../platform/process/pty/snapshot'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import { PtyHostSupervisor } from '../../../../platform/process/ptyHost/supervisor'
import { TerminalProfileResolver } from '../../../../platform/terminal/TerminalProfileResolver'
import type { GeminiSessionDiscoveryCursor } from '../../../agent/infrastructure/cli/AgentSessionLocatorProviders'
import { createSessionStateWatcherController } from './sessionStateWatcher'

const PTY_DATA_FLUSH_DELAY_MS = 32
const PTY_DATA_HIGH_VOLUME_FLUSH_DELAY_MS = 64
const PTY_DATA_HIGH_VOLUME_BATCH_CHARS = 32_000
const PTY_DATA_MAX_BATCH_CHARS = 256_000

export interface StartSessionStateWatcherInput {
  sessionId: string
  provider: AgentProviderId
  cwd: string
  launchMode: AgentLaunchMode
  resumeSessionId: string | null
  startedAtMs: number
  opencodeBaseUrl?: string | null
  geminiDiscoveryCursor?: GeminiSessionDiscoveryCursor | null
}

export interface PtyRuntime {
  listProfiles?: () => Promise<ListTerminalProfilesResult>
  spawnTerminalSession?: (input: SpawnTerminalInput) => Promise<SpawnTerminalResult>
  spawnSession: (options: SpawnPtyOptions) => Promise<{ sessionId: string }>
  write: (sessionId: string, data: string, encoding?: TerminalWriteEncoding) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  kill: (sessionId: string) => void
  attach: (contentsId: number, sessionId: string) => void
  detach: (contentsId: number, sessionId: string) => void
  snapshot: (sessionId: string) => string
  startSessionStateWatcher: (input: StartSessionStateWatcherInput) => void
  debugCrashHost?: () => void
  dispose: () => void
}

function reportStateWatcherIssue(message: string): void {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  process.stderr.write(`${message}\n`)
}

export function createPtyRuntime(): PtyRuntime {
  const profileResolver = new TerminalProfileResolver()
  const activeSessions = new Set<string>()
  const terminatedSessions = new Set<string>()
  const snapshots = new Map<string, SnapshotState>()
  const terminalProbeBufferBySession = new Map<string, string>()
  const pendingPtyDataChunksBySession = new Map<string, string[]>()
  const pendingPtyDataCharsBySession = new Map<string, number>()
  const pendingPtyDataFlushTimerBySession = new Map<string, NodeJS.Timeout>()
  const pendingPtyDataFlushDelayBySession = new Map<string, number>()
  const ptyDataSubscribersBySessionId = new Map<string, Set<number>>()
  const ptyDataSessionsByWebContentsId = new Map<number, Set<string>>()
  const ptyDataSubscribedWebContentsIds = new Set<number>()

  const sendToAllWindows = <Payload>(channel: string, payload: Payload): void => {
    for (const content of webContents.getAllWebContents()) {
      if (content.isDestroyed() || content.getType() !== 'window') {
        continue
      }

      try {
        content.send(channel, payload)
      } catch {
        // Ignore delivery failures (destroyed webContents, navigation in progress, etc.)
      }
    }
  }

  const sessionStateWatcher = createSessionStateWatcherController({
    sendToAllWindows,
    reportIssue: reportStateWatcherIssue,
  })

  const logsDir = resolve(app.getPath('userData'), 'logs')
  const ptyHostLogFilePath = resolve(logsDir, 'pty-host.log')
  const ptyHost = new PtyHostSupervisor({
    baseDir: __dirname,
    logFilePath: ptyHostLogFilePath,
    reportIssue: reportStateWatcherIssue,
    createProcess: modulePath =>
      utilityProcess.fork(modulePath, [], { stdio: 'pipe', serviceName: 'OpenCove PTY Host' }),
  })

  const cleanupPtyDataSubscriptions = (contentsId: number): void => {
    const sessions = ptyDataSessionsByWebContentsId.get(contentsId)
    if (!sessions) {
      return
    }

    ptyDataSessionsByWebContentsId.delete(contentsId)

    for (const sessionId of sessions) {
      const subscribers = ptyDataSubscribersBySessionId.get(sessionId)
      if (!subscribers) {
        continue
      }

      subscribers.delete(contentsId)
      if (subscribers.size === 0) {
        ptyDataSubscribersBySessionId.delete(sessionId)
      }

      syncSessionProbeBuffer(sessionId)
    }
  }

  const cleanupSessionPtyDataSubscriptions = (sessionId: string): void => {
    const subscribers = ptyDataSubscribersBySessionId.get(sessionId)
    if (!subscribers) {
      return
    }

    ptyDataSubscribersBySessionId.delete(sessionId)

    for (const contentsId of subscribers) {
      const sessions = ptyDataSessionsByWebContentsId.get(contentsId)
      sessions?.delete(sessionId)
      if (sessions && sessions.size === 0) {
        ptyDataSessionsByWebContentsId.delete(contentsId)
      }
    }
  }

  const trackWebContentsSubscriptionLifecycle = (contentsId: number): void => {
    if (ptyDataSubscribedWebContentsIds.has(contentsId)) {
      return
    }

    const content = webContents.fromId(contentsId)
    if (!content) {
      return
    }

    ptyDataSubscribedWebContentsIds.add(contentsId)
    content.once('destroyed', () => {
      ptyDataSubscribedWebContentsIds.delete(contentsId)
      cleanupPtyDataSubscriptions(contentsId)
    })
  }

  const hasPtyDataSubscribers = (sessionId: string): boolean => {
    const subscribers = ptyDataSubscribersBySessionId.get(sessionId)
    return Boolean(subscribers && subscribers.size > 0)
  }

  const syncSessionProbeBuffer = (sessionId: string): void => {
    if (hasPtyDataSubscribers(sessionId)) {
      terminalProbeBufferBySession.delete(sessionId)
      return
    }

    terminalProbeBufferBySession.set(sessionId, '')
  }

  const sendPtyDataToSubscribers = (eventPayload: TerminalDataEvent): void => {
    const subscribers = ptyDataSubscribersBySessionId.get(eventPayload.sessionId)
    if (!subscribers || subscribers.size === 0) {
      return
    }

    for (const contentsId of subscribers) {
      const content = webContents.fromId(contentsId)
      if (!content || content.isDestroyed() || content.getType() !== 'window') {
        continue
      }

      try {
        content.send(IPC_CHANNELS.ptyData, eventPayload)
      } catch {
        // Ignore delivery failures (destroyed webContents, navigation in progress, etc.)
      }
    }
  }

  const resolvePtyDataFlushDelay = (pendingChars: number): number => {
    return pendingChars >= PTY_DATA_HIGH_VOLUME_BATCH_CHARS
      ? PTY_DATA_HIGH_VOLUME_FLUSH_DELAY_MS
      : PTY_DATA_FLUSH_DELAY_MS
  }

  const flushPtyDataBroadcast = (sessionId: string): void => {
    const timer = pendingPtyDataFlushTimerBySession.get(sessionId)
    if (timer) {
      clearTimeout(timer)
      pendingPtyDataFlushTimerBySession.delete(sessionId)
    }

    pendingPtyDataFlushDelayBySession.delete(sessionId)

    const chunks = pendingPtyDataChunksBySession.get(sessionId)
    if (!chunks || chunks.length === 0) {
      pendingPtyDataChunksBySession.delete(sessionId)
      pendingPtyDataCharsBySession.delete(sessionId)
      return
    }

    pendingPtyDataChunksBySession.delete(sessionId)
    pendingPtyDataCharsBySession.delete(sessionId)

    const data = chunks.length === 1 ? (chunks[0] ?? '') : chunks.join('')
    if (data.length === 0) {
      return
    }

    if (activeSessions.has(sessionId)) {
      const snapshot = snapshots.get(sessionId)
      if (snapshot) {
        appendSnapshotData(snapshot, data)
      }
    }

    if (!hasPtyDataSubscribers(sessionId)) {
      return
    }

    const eventPayload: TerminalDataEvent = { sessionId, data }
    sendPtyDataToSubscribers(eventPayload)
  }

  const queuePtyDataBroadcast = (sessionId: string, data: string): void => {
    if (data.length === 0) {
      return
    }

    const chunks = pendingPtyDataChunksBySession.get(sessionId) ?? []
    if (chunks.length === 0) {
      pendingPtyDataChunksBySession.set(sessionId, chunks)
    }

    chunks.push(data)
    const pendingChars = (pendingPtyDataCharsBySession.get(sessionId) ?? 0) + data.length
    pendingPtyDataCharsBySession.set(sessionId, pendingChars)

    if (pendingChars >= PTY_DATA_MAX_BATCH_CHARS) {
      flushPtyDataBroadcast(sessionId)
      return
    }

    const nextDelayMs = resolvePtyDataFlushDelay(pendingChars)
    const existingTimer = pendingPtyDataFlushTimerBySession.get(sessionId)
    const existingDelayMs = pendingPtyDataFlushDelayBySession.get(sessionId)

    if (existingTimer && existingDelayMs !== undefined) {
      if (existingDelayMs >= nextDelayMs) {
        return
      }

      clearTimeout(existingTimer)
      pendingPtyDataFlushTimerBySession.delete(sessionId)
    }

    pendingPtyDataFlushDelayBySession.set(sessionId, nextDelayMs)
    pendingPtyDataFlushTimerBySession.set(
      sessionId,
      setTimeout(() => {
        flushPtyDataBroadcast(sessionId)
      }, nextDelayMs),
    )
  }

  const registerSessionProbeState = (sessionId: string): void => {
    terminalProbeBufferBySession.set(sessionId, '')
  }

  const clearSessionProbeState = (sessionId: string): void => {
    terminalProbeBufferBySession.delete(sessionId)
  }

  const startSessionStateWatcher = ({
    sessionId,
    provider,
    cwd,
    launchMode,
    resumeSessionId,
    startedAtMs,
    opencodeBaseUrl,
  }: StartSessionStateWatcherInput): void => {
    sessionStateWatcher.start({
      sessionId,
      provider,
      cwd,
      launchMode,
      resumeSessionId,
      startedAtMs,
      opencodeBaseUrl,
    })
  }

  const resolveTerminalProbeReplies = (sessionId: string, outputChunk: string): void => {
    if (outputChunk.includes('\u001b[6n')) {
      ptyHost.write(sessionId, '\u001b[1;1R')
    }

    if (outputChunk.includes('\u001b[?6n')) {
      ptyHost.write(sessionId, '\u001b[?1;1R')
    }

    if (outputChunk.includes('\u001b[c')) {
      ptyHost.write(sessionId, '\u001b[?1;2c')
    }

    if (outputChunk.includes('\u001b[>c')) {
      ptyHost.write(sessionId, '\u001b[>0;115;0c')
    }

    if (outputChunk.includes('\u001b[?u')) {
      ptyHost.write(sessionId, '\u001b[?0u')
    }
  }

  ptyHost.onData(({ sessionId, data }) => {
    if (!terminatedSessions.has(sessionId)) {
      activeSessions.add(sessionId)
      if (!snapshots.has(sessionId)) {
        snapshots.set(sessionId, createEmptySnapshotState())
      }
    }

    if (!hasPtyDataSubscribers(sessionId)) {
      const probeBuffer = `${terminalProbeBufferBySession.get(sessionId) ?? ''}${data}`
      resolveTerminalProbeReplies(sessionId, probeBuffer)
      terminalProbeBufferBySession.set(sessionId, probeBuffer.slice(-32))
    }

    queuePtyDataBroadcast(sessionId, data)
  })

  ptyHost.onExit(({ sessionId, exitCode }) => {
    flushPtyDataBroadcast(sessionId)
    clearSessionProbeState(sessionId)
    sessionStateWatcher.disposeSession(sessionId)
    cleanupSessionPtyDataSubscriptions(sessionId)
    activeSessions.delete(sessionId)
    terminatedSessions.add(sessionId)
    const eventPayload: TerminalExitEvent = {
      sessionId,
      exitCode,
    }
    sendToAllWindows(IPC_CHANNELS.ptyExit, eventPayload)
  })

  return {
    listProfiles: async () => await profileResolver.listProfiles(),
    spawnTerminalSession: async input => {
      const resolved = await profileResolver.resolveTerminalSpawn(input)
      const { sessionId } = await ptyHost.spawn({
        cwd: resolved.cwd,
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cols: input.cols,
        rows: input.rows,
      })

      activeSessions.add(sessionId)
      terminatedSessions.delete(sessionId)
      if (!snapshots.has(sessionId)) {
        snapshots.set(sessionId, createEmptySnapshotState())
      }
      registerSessionProbeState(sessionId)

      return {
        sessionId,
        profileId: resolved.profileId,
        runtimeKind: resolved.runtimeKind,
      }
    },
    spawnSession: async options => {
      const command = options.command ?? options.shell ?? resolveDefaultShell()
      const args = options.command ? (options.args ?? []) : []

      const { sessionId } = await ptyHost.spawn({
        cwd: options.cwd,
        command,
        args,
        env: options.env,
        cols: options.cols,
        rows: options.rows,
      })

      activeSessions.add(sessionId)
      terminatedSessions.delete(sessionId)
      if (!snapshots.has(sessionId)) {
        snapshots.set(sessionId, createEmptySnapshotState())
      }
      registerSessionProbeState(sessionId)
      return { sessionId }
    },
    write: (sessionId, data, encoding = 'utf8') => {
      ptyHost.write(sessionId, data, encoding)
      sessionStateWatcher.noteInteraction(sessionId, data)
    },
    resize: (sessionId, cols, rows) => {
      ptyHost.resize(sessionId, cols, rows)
    },
    kill: sessionId => {
      flushPtyDataBroadcast(sessionId)
      clearSessionProbeState(sessionId)
      sessionStateWatcher.disposeSession(sessionId)
      cleanupSessionPtyDataSubscriptions(sessionId)
      activeSessions.delete(sessionId)
      terminatedSessions.add(sessionId)
      snapshots.delete(sessionId)
      ptyHost.kill(sessionId)
    },
    attach: (contentsId, sessionId) => {
      trackWebContentsSubscriptionLifecycle(contentsId)

      const sessions = ptyDataSessionsByWebContentsId.get(contentsId) ?? new Set<string>()
      sessions.add(sessionId)
      ptyDataSessionsByWebContentsId.set(contentsId, sessions)

      const subscribers = ptyDataSubscribersBySessionId.get(sessionId) ?? new Set<number>()
      subscribers.add(contentsId)
      ptyDataSubscribersBySessionId.set(sessionId, subscribers)

      syncSessionProbeBuffer(sessionId)
      flushPtyDataBroadcast(sessionId)
    },
    detach: (contentsId, sessionId) => {
      const sessions = ptyDataSessionsByWebContentsId.get(contentsId)
      sessions?.delete(sessionId)
      if (sessions && sessions.size === 0) {
        ptyDataSessionsByWebContentsId.delete(contentsId)
      }

      const subscribers = ptyDataSubscribersBySessionId.get(sessionId)
      subscribers?.delete(contentsId)
      if (subscribers && subscribers.size === 0) {
        ptyDataSubscribersBySessionId.delete(sessionId)
      }

      syncSessionProbeBuffer(sessionId)
    },
    snapshot: sessionId => {
      flushPtyDataBroadcast(sessionId)
      const snapshot = snapshots.get(sessionId)
      return snapshot ? snapshotToString(snapshot) : ''
    },
    startSessionStateWatcher,
    ...(process.env.NODE_ENV === 'test'
      ? {
          debugCrashHost: () => {
            ptyHost.crash()
          },
        }
      : {}),
    dispose: () => {
      sessionStateWatcher.dispose()

      pendingPtyDataFlushTimerBySession.forEach(timer => {
        clearTimeout(timer)
      })
      pendingPtyDataFlushTimerBySession.clear()
      pendingPtyDataFlushDelayBySession.clear()
      pendingPtyDataChunksBySession.clear()
      pendingPtyDataCharsBySession.clear()
      ptyDataSubscribersBySessionId.clear()
      ptyDataSessionsByWebContentsId.clear()
      ptyDataSubscribedWebContentsIds.clear()
      terminalProbeBufferBySession.clear()

      activeSessions.clear()
      terminatedSessions.clear()
      snapshots.clear()
      ptyHost.dispose()
    },
  }
}
