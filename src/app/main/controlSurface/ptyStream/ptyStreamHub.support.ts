import { TerminalPresentationSession } from '../../../../platform/terminal/presentation/TerminalPresentationSession'
import type {
  GetSessionPresentationSnapshotResult,
  GetSessionSnapshotResult,
} from '../../../../shared/contracts/dto'
import type { SessionState } from './ptyStreamState'

const PTY_DATA_FLUSH_DELAY_MS = 32
const PTY_DATA_MAX_BATCH_CHARS = 256_000

export function createSessionState(sessionId: string): SessionState {
  return {
    sessionId,
    metadata: null,
    status: 'running',
    exitCode: null,
    seq: 0,
    chunks: [],
    totalBytes: 0,
    truncated: false,
    agentState: null,
    agentMetadata: null,
    pendingChunks: [],
    pendingChars: 0,
    flushTimer: null,
    subscribers: new Set(),
    controllerClientId: null,
    presentationSession: new TerminalPresentationSession({ sessionId }),
  }
}

export function flushBufferedSessionData(options: {
  session: SessionState
  replayWindowMaxBytes: number
  onChunk: (seq: number, data: string) => void
}): void {
  const { session } = options

  if (session.flushTimer) {
    clearTimeout(session.flushTimer)
    session.flushTimer = null
  }

  const chunks = session.pendingChunks
  if (chunks.length === 0) {
    session.pendingChars = 0
    return
  }

  session.pendingChunks = []
  session.pendingChars = 0

  const data = chunks.length === 1 ? (chunks[0] ?? '') : chunks.join('')
  if (data.length === 0) {
    return
  }

  session.seq += 1
  const seq = session.seq

  if (data.length >= options.replayWindowMaxBytes) {
    session.chunks = [{ seq, data: data.slice(-options.replayWindowMaxBytes) }]
    session.totalBytes = options.replayWindowMaxBytes
    session.truncated = true
    options.onChunk(seq, session.chunks[0]?.data ?? '')
    return
  }

  session.chunks.push({ seq, data })
  session.totalBytes += data.length

  while (session.totalBytes > options.replayWindowMaxBytes && session.chunks.length > 0) {
    const head = session.chunks.shift()
    if (!head) {
      break
    }
    session.totalBytes -= head.data.length
    session.truncated = true
  }

  options.onChunk(seq, data)
}

export function queueBufferedSessionData(session: SessionState, data: string): boolean {
  if (data.length === 0) {
    return false
  }

  session.pendingChunks.push(data)
  session.pendingChars += data.length
  return session.pendingChars >= PTY_DATA_MAX_BATCH_CHARS
}

export function scheduleSessionFlush(session: SessionState, flush: () => void): void {
  if (session.flushTimer) {
    return
  }

  session.flushTimer = setTimeout(() => {
    flush()
  }, PTY_DATA_FLUSH_DELAY_MS)
}

export function snapshotSessionScrollback(session: SessionState): GetSessionSnapshotResult {
  const fromSeq = session.chunks[0]?.seq ?? session.seq
  const scrollback =
    session.chunks.length === 0 ? '' : session.chunks.map(chunk => chunk.data).join('')

  return {
    sessionId: session.sessionId,
    fromSeq,
    toSeq: session.seq,
    scrollback,
    truncated: session.truncated,
  }
}

export async function snapshotSessionPresentation(
  session: SessionState,
): Promise<GetSessionPresentationSnapshotResult> {
  return await session.presentationSession.snapshot()
}
