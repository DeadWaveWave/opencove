import type { SessionFileAccess } from './ClaudeTranscriptAccess'
import { ClaudeTranscriptCheckpoint } from './ClaudeTranscriptCheckpoint'
import type { ClaudeTranscriptObservation } from '../../../../shared/runtime/agentHook/claudeTranscript'
import { parseClaudeTranscript } from './ClaudeTranscriptParser'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import { StringDecoder } from 'node:string_decoder'
import type { AgentProviderId, TerminalSessionState } from '@shared/contracts/dto'
import {
  SessionTurnStateProjection,
  type SessionFileStateOptions,
} from './SessionTurnStateProjection'

interface SessionTurnStateWatcherOptions {
  provider: AgentProviderId
  sessionId: string
  filePath: string
  initialRead?: 'baseline' | 'live'
  onState: (
    sessionId: string,
    state: TerminalSessionState,
    options?: SessionFileStateOptions,
  ) => void
  onClaudeTranscript?: (
    record: Omit<ClaudeTranscriptObservation, 'sessionId' | 'providerSessionId' | 'generation'>,
  ) => void
  fileAccess?: SessionFileAccess
  checkpoint?: boolean
  shouldPoll?: () => boolean
  pollIntervalMs?: number
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

function scanJsonRecordCandidates(text: string): {
  records: string[]
  remainder: string
  invalid: boolean
} {
  const records: string[] = []
  let invalid = false
  let index = 0
  let recordStart: number | null = null
  let depth = 0
  let inString = false
  let escaped = false

  while (index < text.length) {
    const char = text[index]
    if (recordStart === null) {
      const code = text.charCodeAt(index)
      if (code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d) {
        index += 1
        continue
      }

      if (char !== '{') {
        invalid = true
        const nextLineBreak = text.indexOf('\n', index)
        if (nextLineBreak === -1) {
          return { records, remainder: text.slice(index), invalid }
        }

        index = nextLineBreak + 1
        continue
      }

      recordStart = index
      depth = 1
      inString = false
      escaped = false
      index += 1
      continue
    }

    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }

      index += 1
      continue
    }

    if (char === '"') {
      inString = true
      index += 1
      continue
    }

    if (char === '{') {
      depth += 1
      index += 1
      continue
    }

    if (char === '}') {
      depth -= 1
      if (depth === 0) {
        records.push(text.slice(recordStart, index + 1))
        recordStart = null
      }
    }

    index += 1
  }

  return {
    records,
    invalid,
    remainder: recordStart === null ? '' : text.slice(recordStart),
  }
}

export class SessionTurnStateWatcher {
  private readonly provider: AgentProviderId
  private readonly filePath: string
  private readonly stateProjection: SessionTurnStateProjection
  private readonly onError?: (error: unknown) => void

  private checkpoint = new ClaudeTranscriptCheckpoint()
  private readonly fileAccess?: SessionFileAccess
  private readonly emitCheckpoint: boolean
  private fileIdentity = ''
  private fileEpoch = 0
  private lastMtime?: number
  private recordPosition = 0
  private partialBaseline = false
  private readonly onClaudeTranscript: SessionTurnStateWatcherOptions['onClaudeTranscript']

  private poll: ReturnType<typeof setInterval> | undefined
  private readonly shouldPoll?: () => boolean
  private readonly pollIntervalMs?: number
  private watcher: fs.FSWatcher | null = null
  private offset = 0
  private readingBaseline = true
  private remainder = ''
  private decoder = new StringDecoder('utf8')
  private disposed = false
  private processing = false
  private hasPendingRead = false

  public constructor(options: SessionTurnStateWatcherOptions) {
    this.provider = options.provider
    this.filePath = options.filePath
    this.readingBaseline = options.initialRead !== 'live'
    this.stateProjection = new SessionTurnStateProjection(options.provider, (state, metadata) =>
      options.onState(options.sessionId, state, metadata),
    )
    this.fileAccess = options.fileAccess
    this.emitCheckpoint = options.checkpoint === true
    this.shouldPoll = options.shouldPoll
    this.pollIntervalMs = options.pollIntervalMs
    this.onError = options.onError
    this.onClaudeTranscript = options.onClaudeTranscript
  }

  public start(): void {
    if (this.disposed) {
      return
    }

    this.scheduleRead()
    if (this.pollIntervalMs && !this.poll) {
      this.poll = setInterval(() => {
        if (this.shouldPoll?.() !== false) {
          this.scheduleRead()
        }
      }, this.pollIntervalMs)
      this.poll.unref?.()
    }

    // Native watch is pathname-based and cannot bind the validated descriptor across swaps.
    // Secured transcripts use validated polling plus immediate hook refreshes instead.
    if (!this.fileAccess) {
      this.attachWatcher()
    }
  }

  private attachWatcher(): void {
    try {
      const watcher = fs.watch(this.filePath, () => this.scheduleRead())
      this.watcher = watcher
      watcher.on('error', error => {
        if (this.disposed || this.watcher !== watcher) {
          return
        }
        this.watcher = null
        watcher.close()
        this.onError?.(error)
      })
    } catch (error) {
      if (!this.disposed && !isFileMissingError(error)) {
        this.onError?.(error)
      }
    }
  }

  public dispose(): void {
    if (this.disposed) {
      return
    }

    this.disposed = true
    this.checkpoint.dispose()
    if (this.poll) {
      clearInterval(this.poll)
    }

    if (this.watcher) {
      this.watcher.close()
      this.watcher = null
    }
  }

  public refresh(): void {
    this.scheduleRead()
  }

  public noteInteraction(data?: string): void {
    if (!isExplicitSubmitInteraction(data)) {
      return
    }

    // Renderer may optimistically broadcast `working` on explicit submit before the
    // durable session file appends the next turn's final state. Reset the watcher-side
    // state so a subsequent durable `standby` record is not suppressed as a duplicate.
    this.stateProjection.noteInteraction()
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
        try {
          // eslint-disable-next-line no-await-in-loop -- the owner must serialize filesystem reads
          await this.readFileDelta()
        } catch (error) {
          if (!this.disposed && !isFileMissingError(error)) {
            this.onError?.(error)
          }
        }
      } while (this.hasPendingRead && !this.disposed)
    } finally {
      this.processing = false
      // No await between the final pending check and releasing ownership.
      if (this.hasPendingRead && !this.disposed) {
        this.scheduleRead()
      }
    }
  }

  private async readFileDelta(): Promise<void> {
    const handle = this.fileAccess
      ? await this.fileAccess.open()
      : await fsPromises.open(this.filePath, 'r')

    try {
      const stats = await handle.stat()
      if (this.disposed) {
        return
      }
      const identity = `${stats.dev}:${stats.ino}`
      const replaced = this.fileIdentity !== '' && this.fileIdentity !== identity
      this.fileIdentity = identity

      const rewritten =
        stats.size === this.offset &&
        this.lastMtime !== undefined &&
        stats.mtimeMs !== this.lastMtime
      this.lastMtime = stats.mtimeMs
      if (replaced || rewritten || stats.size < this.offset) {
        this.offset = 0
        this.readingBaseline = true
        this.stateProjection.reset()
        this.remainder = ''
        this.recordPosition = 0
        this.fileEpoch++
        this.checkpoint = new ClaudeTranscriptCheckpoint()
        this.onClaudeTranscript?.({
          fileIdentity: `${identity}:${this.fileEpoch}`,
          position: 0,
          baseline: true,
          unavailable: true,
        })
        this.decoder = new StringDecoder('utf8')
      }

      if (stats.size === this.offset) {
        // A fresh EOF stat plus the folded terminal record is positive evidence, not timer readiness.
        if (this.emitCheckpoint && this.offset > 0 && this.remainder.length === 0) {
          this.onClaudeTranscript?.({
            fileIdentity: `${this.fileIdentity}:${this.fileEpoch}`,
            position: ++this.recordPosition,
            baseline: false,
            record: this.checkpoint.read(true),
          })
        }
        if (this.fileEpoch === 0 || this.offset > 0) {
          this.readingBaseline = false
        }
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

        if (this.disposed) {
          return
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
      const complete = (await handle.stat()).size === position
      if (!complete) {
        this.hasPendingRead = true
      }
      if (this.emitCheckpoint && complete && !this.disposed) {
        this.onClaudeTranscript?.({
          fileIdentity: `${this.fileIdentity}:${this.fileEpoch}`,
          position: ++this.recordPosition,
          baseline: this.readingBaseline,
          record: this.checkpoint.read(this.remainder.length === 0),
        })
      }
      this.partialBaseline =
        (this.readingBaseline || this.partialBaseline) && this.remainder.length > 0
      if (complete && this.remainder.length === 0 && !this.disposed) {
        this.stateProjection.flushBaseline()
      }
      this.readingBaseline = false
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
    const scanned = scanJsonRecordCandidates(merged)
    if (scanned.invalid) {
      this.checkpoint.invalidate()
    }
    scanned.records.forEach(record => {
      this.consumeLine(record)
    })
    this.remainder = scanned.remainder
    if (this.remainder.length > 1024 * 1024) {
      this.remainder = ''
      this.checkpoint.invalidate()
      this.onClaudeTranscript?.({
        fileIdentity: `${this.fileIdentity}:${this.fileEpoch}`,
        position: ++this.recordPosition,
        baseline: this.readingBaseline,
        unavailable: true,
      })
    }
  }

  private consumeLine(line: string): void {
    if (this.disposed) {
      return
    }
    const baseline = this.readingBaseline || this.partialBaseline
    this.partialBaseline = false
    if (this.provider === 'claude-code') {
      const record = parseClaudeTranscript(line)
      this.checkpoint.observe(record, line)
      this.onClaudeTranscript?.({
        fileIdentity: `${this.fileIdentity}:${this.fileEpoch}`,
        position: ++this.recordPosition,
        baseline,
        reading: this.emitCheckpoint,
        record,
      })
    }
    if (!this.disposed) {
      this.stateProjection.observe(line, baseline)
    }
  }
}
