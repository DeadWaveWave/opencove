import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { sendPtyError } from './ptyStreamWire'
import type { ClientState, SessionState } from './ptyStreamState'
import { logPtyStreamResizeDiagnostics } from './ptyStreamDiagnostics'

type ResizeReason = 'frame_commit' | 'appearance_commit'

export type PtyStreamHubResizeOptions = {
  clientId: string
  sessionId: string
  cols: number
  rows: number
  reason?: ResizeReason | null
  revision?: number | null
}

function normalizePositiveRevision(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }

  return Math.floor(value)
}

function resizePtyRuntime(options: {
  ptyRuntime: ControlSurfacePtyRuntime
  sessionId: string
  cols: number
  rows: number
  reason: ResizeReason
  revision: number | null
}): void {
  if (options.revision !== null) {
    options.ptyRuntime.resize(
      options.sessionId,
      options.cols,
      options.rows,
      options.reason,
      options.revision,
    )
    return
  }

  options.ptyRuntime.resize(options.sessionId, options.cols, options.rows, options.reason)
}

export function resizePtyStreamSession(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  ptyRuntime: ControlSurfacePtyRuntime
  resize: PtyStreamHubResizeOptions
  broadcastGeometry: (
    sessionId: string,
    cols: number,
    rows: number,
    reason: ResizeReason,
    revision?: number | null,
  ) => void
}): void {
  const session = options.sessions.get(options.resize.sessionId)
  const client = options.clients.get(options.resize.clientId)
  if (!session || !client) {
    return
  }

  if (session.controllerClientId !== options.resize.clientId) {
    sendPtyError(
      client.ws,
      options.resize.sessionId,
      'session.not_controller',
      'Only controller can resize.',
    )
    return
  }

  const geometry = session.presentationSession.resize(
    options.resize.cols,
    options.resize.rows,
    options.resize.revision,
  )
  const resizeReason = options.resize.reason ?? 'frame_commit'
  const requestedRevision = normalizePositiveRevision(options.resize.revision)
  if (!geometry.changed) {
    logPtyStreamResizeDiagnostics({
      event: 'stream-unchanged',
      sessionId: options.resize.sessionId,
      clientId: options.resize.clientId,
      requestedCols: options.resize.cols,
      requestedRows: options.resize.rows,
      cols: geometry.cols,
      rows: geometry.rows,
      reason: resizeReason,
      revision: geometry.revision,
    })
    if (requestedRevision !== null && geometry.revision === requestedRevision) {
      options.broadcastGeometry(
        options.resize.sessionId,
        geometry.cols,
        geometry.rows,
        resizeReason,
        geometry.revision,
      )
    }
    return
  }

  logPtyStreamResizeDiagnostics({
    event: 'stream-forwarded',
    sessionId: options.resize.sessionId,
    clientId: options.resize.clientId,
    requestedCols: options.resize.cols,
    requestedRows: options.resize.rows,
    cols: geometry.cols,
    rows: geometry.rows,
    reason: resizeReason,
    revision: geometry.revision,
  })

  if (session.metadata) {
    session.metadata = {
      ...session.metadata,
      cols: geometry.cols,
      rows: geometry.rows,
    }
  }
  options.broadcastGeometry(
    options.resize.sessionId,
    geometry.cols,
    geometry.rows,
    resizeReason,
    geometry.revision,
  )

  resizePtyRuntime({
    ptyRuntime: options.ptyRuntime,
    sessionId: options.resize.sessionId,
    cols: geometry.cols,
    rows: geometry.rows,
    reason: resizeReason,
    revision: geometry.revision,
  })
}
