import fs from 'node:fs/promises'
import type { AgentLaunchMode, TerminalSessionState } from '../../../../shared/contracts/dto'

interface GeminiSessionStateWatcherOptions {
  sessionId: string
  filePath: string
  launchMode: AgentLaunchMode
  onState: (sessionId: string, state: TerminalSessionState) => void
  onError?: (error: unknown) => void
}

interface GeminiSessionSnapshot {
  signature: string
  lastRelevantMessageType: 'user' | 'gemini' | null
}

const GEMINI_STATUS_POLL_INTERVAL_MS = 250

function isRetryableReadError(error: unknown): boolean {
  if (error instanceof SyntaxError) {
    return true
  }

  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as { code?: unknown }
  return record.code === 'ENOENT'
}

function resolveLastRelevantMessageType(messages: unknown): 'user' | 'gemini' | null {
  if (!Array.isArray(messages)) {
    return null
  }

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (!message || typeof message !== 'object' || !('type' in message)) {
      continue
    }

    if (message.type === 'user' || message.type === 'gemini') {
      return message.type
    }
  }

  return null
}

function parseGeminiSessionSnapshot(rawContents: string): GeminiSessionSnapshot {
  const parsed = JSON.parse(rawContents) as {
    lastUpdated?: unknown
    messages?: unknown
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  const lastRelevantMessageType = resolveLastRelevantMessageType(messages)
  const signature = JSON.stringify({
    lastUpdated: parsed.lastUpdated ?? null,
    messages: messages.length,
    lastRelevantMessageType,
  })

  return {
    signature,
    lastRelevantMessageType,
  }
}

async function readGeminiSessionSnapshot(filePath: string): Promise<GeminiSessionSnapshot> {
  await fs.stat(filePath)
  const rawContents = await fs.readFile(filePath, 'utf8')
  return parseGeminiSessionSnapshot(rawContents)
}

export class GeminiSessionStateWatcher {
  private readonly sessionId: string
  private readonly filePath: string
  private readonly launchMode: AgentLaunchMode
  private readonly onState: (sessionId: string, state: TerminalSessionState) => void
  private readonly onError?: (error: unknown) => void

  private disposed = false
  private lastState: TerminalSessionState | null = null
  private hasObservedActiveState = false
  private lastObservedSignature: string | null = null
  private timer: NodeJS.Timeout | null = null
  private polling = false
  private hasPendingPoll = false

  public constructor(options: GeminiSessionStateWatcherOptions) {
    this.sessionId = options.sessionId
    this.filePath = options.filePath
    this.launchMode = options.launchMode
    this.onState = options.onState
    this.onError = options.onError
  }

  public start(): void {
    if (this.disposed) {
      return
    }

    this.scheduleImmediatePoll()
  }

  public dispose(): void {
    this.disposed = true

    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private emitState(state: TerminalSessionState): void {
    if (state === this.lastState) {
      return
    }

    this.lastState = state
    this.onState(this.sessionId, state)
  }

  private scheduleImmediatePoll(): void {
    if (this.disposed) {
      return
    }

    if (this.polling) {
      this.hasPendingPoll = true
      return
    }

    this.polling = true
    void this.poll()
  }

  private scheduleNextPoll(): void {
    if (this.disposed) {
      return
    }

    this.timer = setTimeout(() => {
      this.timer = null
      this.scheduleImmediatePoll()
    }, GEMINI_STATUS_POLL_INTERVAL_MS)
    this.timer.unref?.()
  }

  private resolveNextState(snapshot: GeminiSessionSnapshot | null): TerminalSessionState | null {
    if (!snapshot) {
      return null
    }

    if (snapshot.lastRelevantMessageType === 'user') {
      this.hasObservedActiveState = true
      return 'working'
    }

    if (snapshot.lastRelevantMessageType === 'gemini') {
      return 'standby'
    }

    return this.launchMode === 'resume' || this.hasObservedActiveState ? 'standby' : null
  }

  private async poll(): Promise<void> {
    let shouldScheduleImmediatePoll = false

    try {
      const snapshot = await readGeminiSessionSnapshot(this.filePath)
      if (this.disposed) {
        return
      }

      const hasChanged = snapshot.signature !== this.lastObservedSignature
      if (hasChanged) {
        this.lastObservedSignature = snapshot.signature
        const nextState = this.resolveNextState(snapshot)
        if (nextState) {
          this.emitState(nextState)
        }
      }
    } catch (error) {
      if (this.disposed) {
        return
      }

      if (!isRetryableReadError(error)) {
        this.onError?.(error)
        return
      }
    } finally {
      this.polling = false
    }

    if (this.disposed) {
      return
    }

    if (this.hasPendingPoll) {
      this.hasPendingPoll = false
      shouldScheduleImmediatePoll = true
    }

    if (shouldScheduleImmediatePoll) {
      this.scheduleImmediatePoll()
      return
    }

    this.scheduleNextPoll()
  }
}
