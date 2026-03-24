import { webContents } from 'electron'
import type { IPty } from 'node-pty'
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
import { PtyManager, type SpawnPtyOptions } from '../../../../platform/process/pty/PtyManager'
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
  spawnSession: (options: SpawnPtyOptions) => { sessionId: string }
  write: (sessionId: string, data: string, encoding?: TerminalWriteEncoding) => void
  resize: (sessionId: string, cols: number, rows: number) => void
  kill: (sessionId: string) => void
  attach: (contentsId: number, sessionId: string) => void
  detach: (contentsId: number, sessionId: string) => void
  snapshot: (sessionId: string) => string
  startSessionStateWatcher: (input: StartSessionStateWatcherInput) => void
  dispose: () => void
}

function reportStateWatcherIssue(message: string): void {
  if (process.env.NODE_ENV === 'test') {
    return
  }

  process.stderr.write(`${message}\n`)
}

export function createPtyRuntime(): PtyRuntime {
  const ptyManager = new PtyManager()
  const profileResolver = new TerminalProfileResolver()
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

    ptyManager.appendSnapshotData(sessionId, data)

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
      ptyManager.write(sessionId, '\u001b[1;1R')
    }

    if (outputChunk.includes('\u001b[?6n')) {
      ptyManager.write(sessionId, '\u001b[?1;1R')
    }

    if (outputChunk.includes('\u001b[c')) {
      ptyManager.write(sessionId, '\u001b[?1;2c')
    }

    if (outputChunk.includes('\u001b[>c')) {
      ptyManager.write(sessionId, '\u001b[>0;115;0c')
    }

    if (outputChunk.includes('\u001b[?u')) {
      ptyManager.write(sessionId, '\u001b[?0u')
    }
  }

  const wirePtySessionEvents = (sessionId: string, pty: IPty): void => {
    pty.onData(data => {
      if (!hasPtyDataSubscribers(sessionId)) {
        const probeBuffer = `${terminalProbeBufferBySession.get(sessionId) ?? ''}${data}`
        resolveTerminalProbeReplies(sessionId, probeBuffer)
        terminalProbeBufferBySession.set(sessionId, probeBuffer.slice(-32))
      }

      queuePtyDataBroadcast(sessionId, data)
    })

    pty.onExit(exit => {
      flushPtyDataBroadcast(sessionId)
      clearSessionProbeState(sessionId)
      sessionStateWatcher.disposeSession(sessionId)
      cleanupSessionPtyDataSubscriptions(sessionId)
      ptyManager.delete(sessionId, { keepSnapshot: true })
      const eventPayload: TerminalExitEvent = {
        sessionId,
        exitCode: exit.exitCode,
      }
      sendToAllWindows(IPC_CHANNELS.ptyExit, eventPayload)
    })
  }

  return {
    listProfiles: async () => await profileResolver.listProfiles(),
    spawnTerminalSession: async input => {
      const resolved = await profileResolver.resolveTerminalSpawn(input)
      const { sessionId, pty } = ptyManager.spawnSession({
        cwd: resolved.cwd,
        command: resolved.command,
        args: resolved.args,
        env: resolved.env,
        cols: input.cols,
        rows: input.rows,
      })
      registerSessionProbeState(sessionId)
      wirePtySessionEvents(sessionId, pty)

      return {
        sessionId,
        profileId: resolved.profileId,
        runtimeKind: resolved.runtimeKind,
      }
    },
    spawnSession: options => {
      const { sessionId, pty } = ptyManager.spawnSession(options)
      registerSessionProbeState(sessionId)
      wirePtySessionEvents(sessionId, pty)
      return { sessionId }
    },
    write: (sessionId, data, encoding = 'utf8') => {
      ptyManager.write(sessionId, data, encoding)
      sessionStateWatcher.noteInteraction(sessionId, data)
    },
    resize: (sessionId, cols, rows) => {
      ptyManager.resize(sessionId, cols, rows)
    },
    kill: sessionId => {
      flushPtyDataBroadcast(sessionId)
      clearSessionProbeState(sessionId)
      sessionStateWatcher.disposeSession(sessionId)
      cleanupSessionPtyDataSubscriptions(sessionId)
      ptyManager.kill(sessionId)
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
      return ptyManager.snapshot(sessionId)
    },
    startSessionStateWatcher,
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

      ptyManager.disposeAll()
    },
  }
}
