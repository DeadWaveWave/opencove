import type { PresentationSnapshotTerminalResult } from '../../../../shared/contracts/dto'
import { TerminalPresentationSession } from '../../../../platform/terminal/presentation/TerminalPresentationSession'
import { enqueueSessionOperation } from './ptyStreamHub.operationQueue'
import type { ClientState, SessionState } from './ptyStreamState'
import { sendPtyOverflow } from './ptyStreamWire'

export async function restorePtyStreamPresentationBaseline(options: {
  session: SessionState
  serializedScreen: string
  displayPrefix?: string
}): Promise<void> {
  const { session } = options
  if (session.seq !== 0 || session.pendingChunks.length > 0) {
    throw new Error(`Cannot restore presentation baseline after output: ${session.sessionId}`)
  }
  session.displayPrefix = options.displayPrefix ?? ''
  await session.presentationSession.applyOutput(0, options.serializedScreen)
}

export async function replacePtyStreamPresentationCurrent(options: {
  sessionId: string
  snapshot: PresentationSnapshotTerminalResult
  session: SessionState
  sessions: Map<string, SessionState>
  clients: Map<string, ClientState>
  flushSession: (session: SessionState) => void
}): Promise<void> {
  const { session } = options
  await enqueueSessionOperation(session, async () => {
    if (options.sessions.get(options.sessionId) !== session) {
      return
    }
    options.flushSession(session)
    session.seq += 1
    session.presentationBaselineSeq = session.seq
    session.chunks = []
    session.totalBytes = 0
    session.truncated = false
    session.pendingChunks = []
    session.pendingChars = 0

    const replacement = new TerminalPresentationSession({
      sessionId: options.sessionId,
      cols: options.snapshot.cols,
      rows: options.snapshot.rows,
    })
    replacement.resize(
      options.snapshot.cols,
      options.snapshot.rows,
      options.snapshot.geometryRevision,
    )
    await replacement.applyOutput(
      session.presentationBaselineSeq,
      options.snapshot.serializedScreen,
    )
    if (options.sessions.get(options.sessionId) !== session) {
      replacement.dispose()
      return
    }

    const previous = session.presentationSession
    session.presentationSession = replacement
    if (session.metadata) {
      session.metadata = {
        ...session.metadata,
        cols: options.snapshot.cols,
        rows: options.snapshot.rows,
      }
    }
    previous.dispose()
    for (const clientId of session.subscribers) {
      const client = options.clients.get(clientId)
      if (client) {
        sendPtyOverflow(client.ws, options.sessionId, session.seq, session.presentationBaselineSeq)
      }
    }
  })
}
