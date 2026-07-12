import { randomUUID } from 'node:crypto'
import type {
  ResizeTerminalInput,
  TerminalCanonicalPtyGeometry,
  TerminalGeometryAuthority,
  TerminalGeometryCommitResult,
} from '../../../../shared/contracts/dto'
import type { ControlSurfacePtyRuntime } from '../handlers/sessionPtyRuntime'
import { sendPtyError, sendPtyResizeResult } from './ptyStreamWire'
import type { ClientState, SessionState } from './ptyStreamState'
import { logPtyStreamResizeDiagnostics } from './ptyStreamDiagnostics'
import { enqueueSessionOperation } from './ptyStreamHub.operationQueue'

type ResizeReason = 'frame_commit' | 'appearance_commit'

type BroadcastGeometry = (
  sessionId: string,
  cols: number,
  rows: number,
  reason: ResizeReason,
  revision?: number | null,
) => void

export type PtyStreamHubResizeOptions = {
  clientId: string
  sessionId: string
  cols: number
  rows: number
  reason?: ResizeReason | null
  operationId?: string | null
  baseGeometryRevision?: number | null
  authorityEpoch?: number | null
  revision?: number | null
}

function resolveOperationId(value: string | null | undefined): string {
  const normalized = value?.trim()
  return normalized ? normalized : `legacy-${randomUUID()}`
}

function resolveAuthority(session: SessionState, client: ClientState): TerminalGeometryAuthority {
  return {
    role: client.rolesBySessionId.get(session.sessionId) ?? 'viewer',
    epoch: session.authorityEpoch,
  }
}

function createResult(options: {
  sessionId: string
  operationId: string
  status: TerminalGeometryCommitResult['status']
  changed?: boolean
  session: SessionState | null
  client: ClientState | null
}): TerminalGeometryCommitResult {
  return {
    sessionId: options.sessionId,
    operationId: options.operationId,
    status: options.status,
    changed: options.changed === true,
    geometry: options.session?.presentationSession.getGeometry() ?? null,
    authority:
      options.session && options.client ? resolveAuthority(options.session, options.client) : null,
  }
}

function sameGeometry(
  left: Pick<TerminalCanonicalPtyGeometry, 'cols' | 'rows'>,
  right: Pick<TerminalCanonicalPtyGeometry, 'cols' | 'rows'>,
): boolean {
  return left.cols === right.cols && left.rows === right.rows
}

function updateSessionGeometryMetadata(
  session: SessionState,
  geometry: Pick<TerminalCanonicalPtyGeometry, 'cols' | 'rows'>,
): void {
  if (!session.metadata) {
    return
  }
  session.metadata = {
    ...session.metadata,
    cols: geometry.cols,
    rows: geometry.rows,
  }
}

function isGeometryLeaseCurrent(options: {
  sessions: Map<string, SessionState>
  session: SessionState
  sessionId: string
  controllerClientId: string
  authorityEpoch: number
}): boolean {
  return (
    options.sessions.get(options.sessionId) === options.session &&
    options.session.controllerClientId === options.controllerClientId &&
    options.session.authorityEpoch === options.authorityEpoch
  )
}

async function correctRuntimeAfterGeometryLeaseLoss(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  ptyRuntime: ControlSurfacePtyRuntime
  requester: ClientState
  clientId: string
  sessionId: string
  operationId: string
  resizeReason: ResizeReason
  previousGeometry: TerminalCanonicalPtyGeometry
  confirmedRuntimeGeometry: TerminalCanonicalPtyGeometry
  broadcastGeometry: BroadcastGeometry
}): Promise<TerminalGeometryCommitResult> {
  let confirmedRuntimeGeometry = options.confirmedRuntimeGeometry

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const canonicalSession = options.sessions.get(options.sessionId) ?? null
    const canonicalGeometry =
      canonicalSession?.presentationSession.getGeometry() ?? options.previousGeometry

    if (!sameGeometry(confirmedRuntimeGeometry, canonicalGeometry)) {
      const correctionOperationId = `${options.operationId}:canonical-correction${
        attempt === 0 ? '' : `-${attempt + 1}`
      }`
      let correctionResult: TerminalGeometryCommitResult | undefined
      try {
        // Corrections are intentionally serialized: each retry targets the canonical state observed
        // after the preceding runtime ACK.
        // eslint-disable-next-line no-await-in-loop
        correctionResult = await options.ptyRuntime.resize({
          sessionId: options.sessionId,
          cols: canonicalGeometry.cols,
          rows: canonicalGeometry.rows,
          reason: options.resizeReason,
          operationId: correctionOperationId,
          baseGeometryRevision: null,
          authorityEpoch: null,
        })
      } catch {
        correctionResult = undefined
      }

      if (!correctionResult || correctionResult.status !== 'accepted') {
        break
      }
      confirmedRuntimeGeometry = correctionResult.geometry ?? canonicalGeometry
    }

    const latestSession = options.sessions.get(options.sessionId) ?? null
    const latestGeometry =
      latestSession?.presentationSession.getGeometry() ?? options.previousGeometry
    if (
      latestSession === canonicalSession &&
      sameGeometry(confirmedRuntimeGeometry, latestGeometry)
    ) {
      if (latestSession) {
        options.broadcastGeometry(
          options.sessionId,
          latestGeometry.cols,
          latestGeometry.rows,
          options.resizeReason,
          latestGeometry.revision,
        )
      }
      const currentClient = options.clients.get(options.clientId) ?? null
      const rejected = createResult({
        sessionId: options.sessionId,
        operationId: options.operationId,
        status: latestSession ? 'rejected_stale_authority' : 'session_not_found',
        session: latestSession,
        client: currentClient,
      })
      sendPtyResizeResult(options.requester.ws, rejected)
      return rejected
    }
  }

  const latestSession = options.sessions.get(options.sessionId) ?? null
  const currentClient = options.clients.get(options.clientId) ?? null
  if (!latestSession) {
    const missing = createResult({
      sessionId: options.sessionId,
      operationId: options.operationId,
      status: 'session_not_found',
      session: null,
      client: currentClient,
    })
    sendPtyResizeResult(options.requester.ws, missing)
    return missing
  }

  const committed = latestSession.presentationSession.commitGeometry({
    cols: confirmedRuntimeGeometry.cols,
    rows: confirmedRuntimeGeometry.rows,
  })
  updateSessionGeometryMetadata(latestSession, committed.geometry)
  options.broadcastGeometry(
    options.sessionId,
    committed.geometry.cols,
    committed.geometry.rows,
    options.resizeReason,
    committed.geometry.revision,
  )
  const failed = createResult({
    sessionId: options.sessionId,
    operationId: options.operationId,
    status: 'runtime_failed',
    changed: committed.changed,
    session: latestSession,
    client: currentClient,
  })
  sendPtyResizeResult(options.requester.ws, failed)
  return failed
}

export async function resizePtyStreamSession(options: {
  clients: Map<string, ClientState>
  sessions: Map<string, SessionState>
  ptyRuntime: ControlSurfacePtyRuntime
  resize: PtyStreamHubResizeOptions
  broadcastGeometry: BroadcastGeometry
}): Promise<TerminalGeometryCommitResult> {
  const operationId = resolveOperationId(options.resize.operationId)
  const session = options.sessions.get(options.resize.sessionId) ?? null
  const client = options.clients.get(options.resize.clientId) ?? null

  if (!session || !client) {
    const missing = createResult({
      sessionId: options.resize.sessionId,
      operationId,
      status: 'session_not_found',
      session,
      client,
    })
    if (client) {
      sendPtyResizeResult(client.ws, missing)
    }
    return missing
  }

  const performCommit = async (): Promise<TerminalGeometryCommitResult> => {
    const currentSession = options.sessions.get(options.resize.sessionId) ?? null
    const currentClient = options.clients.get(options.resize.clientId) ?? null
    if (!currentSession || !currentClient) {
      return createResult({
        sessionId: options.resize.sessionId,
        operationId,
        status: 'session_not_found',
        session: currentSession,
        client: currentClient,
      })
    }

    if (
      options.resize.authorityEpoch !== null &&
      options.resize.authorityEpoch !== undefined &&
      options.resize.authorityEpoch !== currentSession.authorityEpoch
    ) {
      const rejected = createResult({
        sessionId: options.resize.sessionId,
        operationId,
        status: 'rejected_stale_authority',
        session: currentSession,
        client: currentClient,
      })
      sendPtyResizeResult(currentClient.ws, rejected)
      return rejected
    }

    if (currentSession.controllerClientId !== options.resize.clientId) {
      sendPtyError(
        currentClient.ws,
        options.resize.sessionId,
        'session.not_controller',
        'Only controller can resize.',
      )
      const rejected = createResult({
        sessionId: options.resize.sessionId,
        operationId,
        status: 'rejected_not_controller',
        session: currentSession,
        client: currentClient,
      })
      sendPtyResizeResult(currentClient.ws, rejected)
      return rejected
    }

    const leaseAuthorityEpoch = currentSession.authorityEpoch
    const previousGeometry = currentSession.presentationSession.getGeometry()

    const plan = currentSession.presentationSession.planGeometryCommit({
      cols: options.resize.cols,
      rows: options.resize.rows,
      ...(options.resize.baseGeometryRevision !== undefined
        ? { baseGeometryRevision: options.resize.baseGeometryRevision }
        : {}),
    })
    const resizeReason = options.resize.reason ?? 'frame_commit'
    if (plan.status === 'superseded') {
      const superseded = createResult({
        sessionId: options.resize.sessionId,
        operationId,
        status: 'superseded',
        session: currentSession,
        client: currentClient,
      })
      sendPtyResizeResult(currentClient.ws, superseded)
      return superseded
    }

    let acceptedRuntimeGeometry: TerminalCanonicalPtyGeometry = plan.geometry

    if (plan.changed) {
      const runtimeInput: ResizeTerminalInput = {
        sessionId: options.resize.sessionId,
        cols: plan.geometry.cols,
        rows: plan.geometry.rows,
        reason: resizeReason,
        operationId,
        ...(options.resize.baseGeometryRevision !== undefined
          ? { baseGeometryRevision: options.resize.baseGeometryRevision }
          : {}),
        ...(options.resize.authorityEpoch !== undefined
          ? { authorityEpoch: options.resize.authorityEpoch }
          : {}),
        ...(options.resize.revision !== undefined ? { revision: options.resize.revision } : {}),
      }

      try {
        const runtimeResult = await options.ptyRuntime.resize(runtimeInput)
        if (runtimeResult && runtimeResult.status !== 'accepted') {
          const failed = createResult({
            sessionId: options.resize.sessionId,
            operationId,
            status: 'runtime_failed',
            session: currentSession,
            client: currentClient,
          })
          sendPtyResizeResult(currentClient.ws, failed)
          return failed
        }
        acceptedRuntimeGeometry = runtimeResult?.geometry ?? plan.geometry

        if (
          !isGeometryLeaseCurrent({
            sessions: options.sessions,
            session: currentSession,
            sessionId: options.resize.sessionId,
            controllerClientId: options.resize.clientId,
            authorityEpoch: leaseAuthorityEpoch,
          })
        ) {
          return await correctRuntimeAfterGeometryLeaseLoss({
            clients: options.clients,
            sessions: options.sessions,
            ptyRuntime: options.ptyRuntime,
            requester: currentClient,
            clientId: options.resize.clientId,
            sessionId: options.resize.sessionId,
            operationId,
            resizeReason,
            previousGeometry,
            confirmedRuntimeGeometry: acceptedRuntimeGeometry,
            broadcastGeometry: options.broadcastGeometry,
          })
        }
      } catch {
        const failed = createResult({
          sessionId: options.resize.sessionId,
          operationId,
          status: 'runtime_failed',
          session: currentSession,
          client: currentClient,
        })
        sendPtyResizeResult(currentClient.ws, failed)
        return failed
      }
    }

    const committed = currentSession.presentationSession.commitGeometry({
      cols: acceptedRuntimeGeometry.cols,
      rows: acceptedRuntimeGeometry.rows,
      ...(options.resize.baseGeometryRevision !== undefined
        ? { baseGeometryRevision: options.resize.baseGeometryRevision }
        : {}),
    })
    if (committed.status === 'superseded') {
      const superseded = createResult({
        sessionId: options.resize.sessionId,
        operationId,
        status: 'superseded',
        session: currentSession,
        client: currentClient,
      })
      sendPtyResizeResult(currentClient.ws, superseded)
      return superseded
    }

    if (committed.changed) {
      updateSessionGeometryMetadata(currentSession, committed.geometry)
    }

    logPtyStreamResizeDiagnostics({
      event: committed.changed ? 'stream-forwarded' : 'stream-unchanged',
      sessionId: options.resize.sessionId,
      clientId: options.resize.clientId,
      requestedCols: options.resize.cols,
      requestedRows: options.resize.rows,
      cols: committed.geometry.cols,
      rows: committed.geometry.rows,
      reason: resizeReason,
      revision: committed.geometry.revision,
    })

    if (committed.changed) {
      options.broadcastGeometry(
        options.resize.sessionId,
        committed.geometry.cols,
        committed.geometry.rows,
        resizeReason,
        committed.geometry.revision,
      )
    }

    const accepted = createResult({
      sessionId: options.resize.sessionId,
      operationId,
      status: 'accepted',
      changed: committed.changed,
      session: currentSession,
      client: currentClient,
    })
    sendPtyResizeResult(currentClient.ws, accepted)
    return accepted
  }

  return await enqueueSessionOperation(session, performCommit)
}
