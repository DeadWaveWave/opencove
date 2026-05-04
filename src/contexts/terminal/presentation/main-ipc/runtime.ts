import { app, utilityProcess, webContents } from 'electron'
import process from 'node:process'
import { resolve } from 'node:path'
import { IPC_CHANNELS } from '../../../../shared/contracts/ipc'
import type {
  AgentLaunchMode,
  AgentProviderId,
  ListTerminalProfilesResult,
  PresentationSnapshotTerminalResult,
  SpawnTerminalInput,
  SpawnTerminalResult,
  TerminalDataEvent,
  TerminalGeometryCommitReason,
  TerminalSessionMetadataEvent,
  TerminalSessionStateEvent,
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import { PtyHostSupervisor } from '../../../../platform/process/ptyHost/supervisor'
import { TerminalProfileResolver } from '../../../../platform/terminal/TerminalProfileResolver'
import { stripAutomaticTerminalQueriesFromOutput } from '../../../../shared/terminal/automaticTerminalSequences'
import type { GeminiSessionDiscoveryCursor } from '../../../agent/infrastructure/cli/AgentSessionLocatorProviders'
import { createSessionStateWatcherController } from './sessionStateWatcher'
import { TerminalSessionManager } from './sessionManager'
import { isDebugCrashHostEnabled } from './debugCrashHost'

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
  write: (sessionId: string, data: string, encoding?: TerminalWriteEncoding) => Promise<void>
  resize: (
    sessionId: string,
    cols: number,
    rows: number,
    reason?: TerminalGeometryCommitReason,
  ) => Promise<void>
  kill: (sessionId: string) => Promise<void>
  onData: (listener: (event: { sessionId: string; data: string }) => void) => () => void
  onExit: (listener: (event: { sessionId: string; exitCode: number }) => void) => () => void
  onState?: (listener: (event: TerminalSessionStateEvent) => void) => () => void
  onMetadata?: (listener: (event: TerminalSessionMetadataEvent) => void) => () => void
  attach: (contentsId: number, sessionId: string, afterSeq?: number | null) => Promise<void>
  detach: (contentsId: number, sessionId: string) => Promise<void>
  snapshot: (sessionId: string) => Promise<string>
  presentationSnapshot: (sessionId: string) => Promise<PresentationSnapshotTerminalResult>
  startSessionStateWatcher: (input: StartSessionStateWatcherInput) => void
  debugCrashHost?: () => void | Promise<void>
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
  const debugCrashHostEnabled = isDebugCrashHostEnabled()
  const writeDiagnosticsEnabled =
    process.env.OPENCOVE_TERMINAL_DIAGNOSTICS === '1' ||
    process.env.OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS === '1'
  const warnedWriteSessions = new Map<string, string>()
  const externalStateListeners = new Set<(event: TerminalSessionStateEvent) => void>()
  const externalMetadataListeners = new Set<(event: TerminalSessionMetadataEvent) => void>()

  const formatInputHeadHex = (value: string, limit = 12): string => {
    const chars = Array.from(value).slice(0, limit)
    return chars
      .map(char => {
        const codePoint = char.codePointAt(0)
        if (codePoint === undefined) {
          return ''
        }
        return codePoint.toString(16).padStart(2, '0')
      })
      .filter(Boolean)
      .join(' ')
  }

  const logPtyWriteDiagnostics = (payload: Record<string, unknown>): void => {
    if (!writeDiagnosticsEnabled) {
      return
    }

    process.stderr.write(
      `[opencove-pty-write] ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`,
    )
  }

  const logPtyResizeDiagnostics = (payload: Record<string, unknown>): void => {
    if (!writeDiagnosticsEnabled) {
      return
    }

    process.stderr.write(
      `[opencove-pty-resize] ${JSON.stringify({ ts: new Date().toISOString(), ...payload })}\n`,
    )
  }

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
    onState: event => {
      externalStateListeners.forEach(listener => listener(event))
    },
    onMetadata: event => {
      externalMetadataListeners.forEach(listener => listener(event))
    },
  })

  const sendPtyDataToSubscriber = (contentsId: number, eventPayload: TerminalDataEvent): void => {
    const content = webContents.fromId(contentsId)
    if (!content || content.isDestroyed() || content.getType() !== 'window') {
      return
    }

    try {
      content.send(IPC_CHANNELS.ptyData, eventPayload)
    } catch {
      // Ignore delivery failures (destroyed webContents, navigation in progress, etc.)
    }
  }

  const trackWebContentsDestroyed = (contentsId: number, onDestroyed: () => void): boolean => {
    const content = webContents.fromId(contentsId)
    if (!content) {
      return false
    }

    content.once('destroyed', onDestroyed)
    return true
  }

  const logsDir = resolve(app.getPath('userData'), 'logs')
  const ptyHostLogFilePath = resolve(logsDir, 'pty-host.log')
  const ptyHost = new PtyHostSupervisor({
    baseDir: __dirname,
    logFilePath: ptyHostLogFilePath,
    reportIssue: reportStateWatcherIssue,
    createProcess: modulePath =>
      utilityProcess.fork(modulePath, [], { stdio: 'pipe', serviceName: 'OpenCove PTY Host' }),
  })

  // --- Probe state (ptyHost-specific, not managed by SessionManager) ---

  const terminalProbeBufferBySession = new Map<string, string>()

  const registerSessionProbeState = (sessionId: string): void => {
    terminalProbeBufferBySession.set(sessionId, '')
  }

  const clearSessionProbeState = (sessionId: string): void => {
    terminalProbeBufferBySession.delete(sessionId)
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

  // --- Session manager ---

  const manager = new TerminalSessionManager({
    sendToAllWindows,
    sendPtyDataToSubscriber,
    trackWebContentsDestroyed,
    sessionStateWatcher,
    onProbeSubscriptionChanged(sessionId: string) {
      if (manager.hasPtyDataSubscribers(sessionId)) {
        terminalProbeBufferBySession.delete(sessionId)
        return
      }

      terminalProbeBufferBySession.set(sessionId, '')
    },
  })

  // --- PtyHost event wiring ---

  const externalDataListeners = new Set<(event: { sessionId: string; data: string }) => void>()
  const externalExitListeners = new Set<(event: { sessionId: string; exitCode: number }) => void>()

  ptyHost.onData(({ sessionId, data }) => {
    const { visibleData, replies } = stripAutomaticTerminalQueriesFromOutput(data)
    replies.forEach(reply => {
      ptyHost.write(sessionId, reply)
    })

    if (!manager.hasPtyDataSubscribers(sessionId)) {
      const probeBuffer = `${terminalProbeBufferBySession.get(sessionId) ?? ''}${visibleData}`
      resolveTerminalProbeReplies(sessionId, probeBuffer)
      terminalProbeBufferBySession.set(sessionId, probeBuffer.slice(-32))
    }

    if (visibleData.length === 0) {
      return
    }

    manager.handleData(sessionId, visibleData)

    externalDataListeners.forEach(listener => {
      listener({ sessionId, data: visibleData })
    })
  })

  ptyHost.onExit(({ sessionId, exitCode }) => {
    manager.handleExit(sessionId, exitCode)
    clearSessionProbeState(sessionId)

    externalExitListeners.forEach(listener => {
      listener({ sessionId, exitCode })
    })
  })

  // --- PtyRuntime interface ---

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

      manager.registerSession(sessionId)
      manager.resize(sessionId, input.cols, input.rows)
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
      const env = options.env ? { ...process.env, ...options.env } : undefined

      const { sessionId } = await ptyHost.spawn({
        cwd: options.cwd,
        command,
        args,
        env,
        cols: options.cols,
        rows: options.rows,
      })

      manager.registerSession(sessionId)
      manager.resize(sessionId, options.cols, options.rows)
      registerSessionProbeState(sessionId)
      return { sessionId }
    },
    write: async (sessionId, data, encoding = 'utf8') => {
      const lifecycle = manager.resolveSessionLifecycleState(sessionId)
      if (lifecycle !== 'active') {
        const signature = `${lifecycle}:${encoding}`
        if (warnedWriteSessions.get(sessionId) !== signature) {
          warnedWriteSessions.set(sessionId, signature)
          logPtyWriteDiagnostics({
            event: 'write-to-inactive-session',
            sessionId,
            lifecycle,
            encoding,
            dataLength: data.length,
            dataStartsWithEsc: data.startsWith('\u001b'),
            dataHeadHex: formatInputHeadHex(data),
          })
        }
      }
      ptyHost.write(sessionId, data, encoding)
      sessionStateWatcher.noteInteraction(sessionId, data)
    },
    resize: async (sessionId, cols, rows, reason) => {
      const geometry = manager.resize(sessionId, cols, rows, reason)
      if (!geometry.changed) {
        logPtyResizeDiagnostics({
          event: 'unchanged',
          sessionId,
          requestedCols: cols,
          requestedRows: rows,
          cols: geometry.cols,
          rows: geometry.rows,
          reason,
        })
        return
      }

      logPtyResizeDiagnostics({
        event: 'forwarded',
        sessionId,
        requestedCols: cols,
        requestedRows: rows,
        cols: geometry.cols,
        rows: geometry.rows,
        reason,
      })
      ptyHost.resize(sessionId, geometry.cols, geometry.rows)
    },
    kill: async sessionId => {
      manager.kill(sessionId)
      clearSessionProbeState(sessionId)
      ptyHost.kill(sessionId)
    },
    onData: listener => {
      externalDataListeners.add(listener)
      return () => {
        externalDataListeners.delete(listener)
      }
    },
    onExit: listener => {
      externalExitListeners.add(listener)
      return () => {
        externalExitListeners.delete(listener)
      }
    },
    onState: listener => {
      externalStateListeners.add(listener)
      return () => {
        externalStateListeners.delete(listener)
      }
    },
    onMetadata: listener => {
      externalMetadataListeners.add(listener)
      return () => {
        externalMetadataListeners.delete(listener)
      }
    },
    attach: async (contentsId, sessionId) => {
      manager.attach(contentsId, sessionId)
    },
    detach: async (contentsId, sessionId) => {
      manager.detach(contentsId, sessionId)
    },
    snapshot: async sessionId => {
      return manager.snapshot(sessionId)
    },
    presentationSnapshot: async sessionId => {
      return await manager.presentationSnapshot(sessionId)
    },
    startSessionStateWatcher: ({
      sessionId,
      provider,
      cwd,
      launchMode,
      resumeSessionId,
      startedAtMs,
      opencodeBaseUrl,
      geminiDiscoveryCursor,
    }: StartSessionStateWatcherInput) => {
      manager.startSessionStateWatcher({
        sessionId,
        provider,
        cwd,
        launchMode,
        resumeSessionId,
        startedAtMs,
        opencodeBaseUrl,
        geminiDiscoveryCursor,
      })
    },
    ...(debugCrashHostEnabled
      ? {
          debugCrashHost: () => {
            ptyHost.crash()
          },
        }
      : {}),
    dispose: () => {
      manager.dispose()
      terminalProbeBufferBySession.clear()
      externalDataListeners.clear()
      externalExitListeners.clear()
      externalStateListeners.clear()
      externalMetadataListeners.clear()
      warnedWriteSessions.clear()
      ptyHost.dispose()
    },
  }
}
