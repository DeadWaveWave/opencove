import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import type { AgentProviderId, TerminalSessionState } from '@shared/contracts/dto'
import { detectTurnStateFromSessionLine } from './SessionTurnStateDetector'

interface SessionTurnStateWatcherOptions {
  provider: AgentProviderId
  sessionId: string
  filePath: string
  onState: (sessionId: string, state: TerminalSessionState) => void
  onError?: (error: unknown) => void
}

function isFileMissingError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const record = error as { code?: unknown }
  return record.code === 'ENOENT'
}

const READ_CHUNK_BYTES = 64 * 1024

function isLikelyJsonRecord(line: string): boolean {
  for (let index = 0; index < line.length; index += 1) {
    const code = line.charCodeAt(index)
    if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
      continue
    }

    return code === 0x7b
  }

  return false
}

function isExplicitSubmitInteraction(data: string | undefined): boolean {
  return data === '\r' || data === '\n' || data === '\r\n'
}

export class SessionTurnStateWatcher {
  private readonly provider: AgentProviderId
  private readonly sessionId: string
  private readonly filePath: string
  private readonly onState: (sessionId: string, state: TerminalSessionState) => void
  private readonly onError?: (error: unknown) => void

  private watcher: fs.FSWatcher | null = null
  private offset = 0
  private remainder = ''
  private decoder = new StringDecoder('utf8')
  private disposed = false
  private processing = false
  private hasPendingRead = false
  private lastState: TerminalSessionState | null = null

  public constructor(options: SessionTurnStateWatcherOptions) {
    this.provider = options.provider
    this.sessionId = options.sessionId
    this.filePath = options.filePath
    this.onState = options.onState
    this.onError = options.onError
  }

  public start(): void {
    if (this.disposed) {
      return
    }

    this.scheduleRead()

    try {
      this.watcher = fs.watch(this.filePath, () => {
        this.scheduleRead()
      })
    } catch (error) {
      if (isFileMissingError(error)) {
        return
      }

      this.onError?.(error)
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true

    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  public noteInteraction(data?: string): void {
    if (!isExplicitSubmitInteraction(data)) {
      return
    }

    // Renderer may optimistically broadcast `working` on explicit submit before the
    // durable session file appends the next turn's final state. Reset the watcher-side
    // state so a subsequent durable `standby` record is not suppressed as a duplicate.
    this.lastState = 'working'
  }

  private scheduleRead(): void {
    if (this.disposed) {
      return
    }

    if (this.processing) {
      this.hasPendingRead = true
      return
    }

    this.processing = true
    void this.readLoop()
  }

  private async readLoop(): Promise<void> {
    try {
      await this.readPendingChunks()
    } catch (error) {
      if (!isFileMissingError(error)) {
        this.onError?.(error)
      }
    } finally {
      this.processing = false
    }
  }

  private async readPendingChunks(): Promise<void> {
    this.hasPendingRead = false
    await this.readFileDelta()

    if (this.hasPendingRead && !this.disposed) {
      await this.readPendingChunks()
    }
  }

  private async readFileDelta(): Promise<void> {
    const handle = await fsPromises.open(this.filePath, 'r')

    try {
      const stats = await handle.stat()

      if (stats.size < this.offset) {
        this.offset = 0
        this.remainder = ''
        this.decoder = new StringDecoder('utf8')
      }

      if (stats.size === this.offset) {
        return
      }

      const end = stats.size
      let position = this.offset

      while (position < end && !this.disposed) {
        const bytesToRead = Math.min(READ_CHUNK_BYTES, end - position)
        const buffer = Buffer.allocUnsafe(bytesToRead)
        // eslint-disable-next-line no-await-in-loop
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, position)
        if (bytesRead <= 0) {
          break
        }

        position += bytesRead
        const textChunk = this.decoder.write(buffer.subarray(0, bytesRead))
        if (textChunk.length === 0) {
          continue
        }

        this.consumeTextChunk(textChunk)
      }

      this.offset = position
      this.flushRemainderIfComplete()
    } finally {
      await handle.close()
    }
  }

  private flushRemainderIfComplete(): void {
    if (this.remainder.length === 0 || !isLikelyJsonRecord(this.remainder)) {
      return
    }

    try {
      JSON.parse(this.remainder)
    } catch {
      return
    }

    const line = this.remainder
    this.remainder = ''
    this.consumeLine(line)
  }

  private consumeTextChunk(textChunk: string): void {
    const merged = this.remainder.length > 0 ? `${this.remainder}${textChunk}` : textChunk
    let lineStart = 0
    let nextLineBreak = merged.indexOf('\n', lineStart)

    while (nextLineBreak !== -1) {
      this.consumeLine(merged.slice(lineStart, nextLineBreak))
      lineStart = nextLineBreak + 1
      nextLineBreak = merged.indexOf('\n', lineStart)
    }

    this.remainder = lineStart === 0 ? merged : merged.slice(lineStart)
  }

  private consumeLine(line: string): void {
    const state = detectTurnStateFromSessionLine(this.provider, line)
    if (!state || state === this.lastState) {
      return
    }

    this.lastState = state
    this.onState(this.sessionId, state)
  }
}
