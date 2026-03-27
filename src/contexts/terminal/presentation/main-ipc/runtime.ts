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
  TerminalWriteEncoding,
} from '../../../../shared/contracts/dto'
import { resolveDefaultShell } from '../../../../platform/process/pty/defaultShell'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import { PtyHostSupervisor } from '../../../../platform/process/ptyHost/supervisor'
import { TerminalProfileResolver } from '../../../../platform/terminal/TerminalProfileResolver'
import type { GeminiSessionDiscoveryCursor } from '../../../agent/infrastructure/cli/AgentSessionLocatorProviders'
import { createSessionStateWatcherController } from './sessionStateWatcher'
import { TerminalSessionManager } from './sessionManager'

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

  ptyHost.onData(({ sessionId, data }) => {
    if (!manager.hasPtyDataSubscribers(sessionId)) {
      const probeBuffer = `${terminalProbeBufferBySession.get(sessionId) ?? ''}${data}`
      resolveTerminalProbeReplies(sessionId, probeBuffer)
      terminalProbeBufferBySession.set(sessionId, probeBuffer.slice(-32))
    }

    manager.handleData(sessionId, data)
  })

  ptyHost.onExit(({ sessionId, exitCode }) => {
    manager.handleExit(sessionId, exitCode)
    clearSessionProbeState(sessionId)
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

      manager.registerSession(sessionId)
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
      manager.kill(sessionId)
      clearSessionProbeState(sessionId)
      ptyHost.kill(sessionId)
    },
    attach: (contentsId, sessionId) => {
      manager.attach(contentsId, sessionId)
    },
    detach: (contentsId, sessionId) => {
      manager.detach(contentsId, sessionId)
    },
    snapshot: sessionId => {
      return manager.snapshot(sessionId)
    },
    startSessionStateWatcher: ({
      sessionId,
      provider,
      cwd,
      launchMode,
      resumeSessionId,
      startedAtMs,
      opencodeBaseUrl,
    }: StartSessionStateWatcherInput) => {
      manager.startSessionStateWatcher({
        sessionId,
        provider,
        cwd,
        launchMode,
        resumeSessionId,
        startedAtMs,
        opencodeBaseUrl,
      })
    },
    ...(process.env.NODE_ENV === 'test'
      ? {
          debugCrashHost: () => {
            ptyHost.crash()
          },
        }
      : {}),
    dispose: () => {
      manager.dispose()
      terminalProbeBufferBySession.clear()
      ptyHost.dispose()
    },
  }
}
