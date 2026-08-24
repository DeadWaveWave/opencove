import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import type { TerminalSessionState } from '../../../../shared/contracts/dto'
import { detectKimiWireState, type KimiWireUnobservableReason } from './KimiWireStateDetector'

interface KimiWireStateWatcherOptions {
  sessionId: string
  filePath: string
  onState: (sessionId: string, state: TerminalSessionState) => void
  onUnavailable?: (sessionId: string, reason: KimiWireUnobservableReason) => void
  onError?: (error: unknown) => void
}

const READ_CHUNK_BYTES = 64 * 1024

function isFileMissingError(error: unknown): boolean {
  return (
    Boolean(error) && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT'
  )
}

function isCompleteJsonRecord(value: string): boolean {
  try {
    JSON.parse(value)
    return true
  } catch {
    return false
  }
}

function isMetadataLine(line: string): boolean {
  try {
    return (JSON.parse(line) as { type?: unknown }).type === 'metadata'
  } catch {
    return false
  }
}

export class KimiWireStateWatcher {
  private readonly sessionId: string
  private readonly filePath: string
  private readonly onState: KimiWireStateWatcherOptions['onState']
  private readonly onUnavailable?: KimiWireStateWatcherOptions['onUnavailable']
  private readonly onError?: KimiWireStateWatcherOptions['onError']
  private watcher: fs.FSWatcher | null = null
  private offset = 0
  private remainder = ''
  private decoder = new StringDecoder('utf8')
  private metadataLine: string | null = null
  private lastMtimeMs = 0
  private lastState: TerminalSessionState | null = null
  private lastUnavailableReason: KimiWireUnobservableReason | null = null
  private processing = false
  private hasPendingRead = false
  private disposed = false

  constructor(options: KimiWireStateWatcherOptions) {
    this.sessionId = options.sessionId
    this.filePath = options.filePath
    this.onState = options.onState
    this.onUnavailable = options.onUnavailable
    this.onError = options.onError
  }

  start(): void {
    if (this.disposed) {
      return
    }
    try {
      this.watcher = fs.watch(this.filePath, () => this.scheduleRead())
    } catch (error) {
      if (isFileMissingError(error)) {
        this.emitUnavailable('missing')
        return
      }
      this.onError?.(error)
      return
    }
    this.scheduleRead()
  }

  dispose(): void {
    if (this.disposed) {
      return
    }
    this.disposed = true
    this.watcher?.close()
    this.watcher = null
  }

  private emitUnavailable(reason: KimiWireUnobservableReason): void {
    if (reason === this.lastUnavailableReason || this.disposed) {
      return
    }
    this.lastUnavailableReason = reason
    this.onUnavailable?.(this.sessionId, reason)
  }

  private emitState(state: TerminalSessionState): void {
    this.lastUnavailableReason = null
    if (state === this.lastState || this.disposed) {
      return
    }
    this.lastState = state
    this.onState(this.sessionId, state)
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
      do {
        this.hasPendingRead = false
        // eslint-disable-next-line no-await-in-loop
        await this.readDelta()
      } while (this.hasPendingRead && !this.disposed)
    } catch (error) {
      if (isFileMissingError(error)) {
        this.emitUnavailable('missing')
      } else {
        this.onError?.(error)
      }
    } finally {
      this.processing = false
    }
  }

  private reset(): void {
    this.offset = 0
    this.remainder = ''
    this.decoder = new StringDecoder('utf8')
    this.metadataLine = null
    this.lastMtimeMs = 0
    this.lastState = null
    this.lastUnavailableReason = null
  }

  private async readDelta(): Promise<void> {
    const handle = await fsPromises.open(this.filePath, 'r')
    try {
      const stats = await handle.stat()
      if (
        stats.size < this.offset ||
        (stats.size === this.offset && stats.mtimeMs > this.lastMtimeMs)
      ) {
        this.reset()
      }
      if (stats.size === this.offset) {
        return
      }

      const wasInitialRead = this.offset === 0
      const lines: string[] = []
      let position = this.offset
      while (position < stats.size && !this.disposed) {
        const bytesToRead = Math.min(READ_CHUNK_BYTES, stats.size - position)
        const buffer = Buffer.allocUnsafe(bytesToRead)
        // eslint-disable-next-line no-await-in-loop
        const { bytesRead } = await handle.read(buffer, 0, bytesToRead, position)
        if (bytesRead <= 0) {
          break
        }
        position += bytesRead
        this.consumeText(this.decoder.write(buffer.subarray(0, bytesRead)), lines)
      }
      this.offset = position
      this.lastMtimeMs = stats.mtimeMs
      if (this.remainder.trim().length > 0 && isCompleteJsonRecord(this.remainder)) {
        lines.push(this.remainder.trim())
        this.remainder = ''
      }
      this.evaluate(lines, wasInitialRead)
    } finally {
      await handle.close()
    }
  }

  private consumeText(text: string, lines: string[]): void {
    const merged = `${this.remainder}${text}`
    const parts = merged.split(/\r?\n/u)
    this.remainder = parts.pop() ?? ''
    parts.forEach(line => {
      if (line.trim().length > 0) {
        lines.push(line.trim())
      }
    })
  }

  private evaluate(lines: string[], wasInitialRead: boolean): void {
    if (lines.length === 0) {
      if (wasInitialRead) {
        this.emitUnavailable('empty')
      }
      return
    }
    for (const line of lines) {
      if (isMetadataLine(line)) {
        this.metadataLine = line
      }
    }
    const content =
      wasInitialRead || !this.metadataLine
        ? lines.join('\n')
        : [this.metadataLine, ...lines.filter(line => line !== this.metadataLine)].join('\n')
    const detection = detectKimiWireState(content)
    if (detection.kind === 'observed') {
      this.emitState(detection.state)
      return
    }
    if (detection.reason === 'state_unavailable' && this.lastState) {
      return
    }
    this.emitUnavailable(detection.reason)
  }
}
