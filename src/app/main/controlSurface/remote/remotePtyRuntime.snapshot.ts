import type { PresentationSnapshotTerminalResult } from '../../../../shared/contracts/dto'
import type { ControlSurfaceRemoteEndpointResolver } from './controlSurfaceHttpClient'
import {
  invokeRemoteControlSurfaceValue,
  parsePresentationSnapshot,
  parseSnapshotScrollback,
} from './remotePtyRuntime.support'

export async function readRemotePtySnapshot(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  sessionId: string
  noteAppliedSequence: (sequence: number) => void
}): Promise<string> {
  const value = await invokeRemoteControlSurfaceValue<unknown>({
    endpointResolver: options.endpointResolver,
    kind: 'query',
    id: 'session.snapshot',
    payload: { sessionId: options.sessionId },
    errorMessage: 'Failed to fetch remote session snapshot',
  })
  const { scrollback, toSeq } = parseSnapshotScrollback(value)
  if (typeof toSeq === 'number') {
    options.noteAppliedSequence(toSeq)
  }
  return scrollback
}

export async function readRemotePtyPresentationSnapshot(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  sessionId: string
  noteGeometryRevision: (revision: number | null | undefined) => void
}): Promise<PresentationSnapshotTerminalResult> {
  const value = await invokeRemoteControlSurfaceValue<unknown>({
    endpointResolver: options.endpointResolver,
    kind: 'query',
    id: 'session.presentationSnapshot',
    payload: { sessionId: options.sessionId },
    errorMessage: 'Failed to fetch remote session presentation snapshot',
  })
  const snapshot = parsePresentationSnapshot(options.sessionId, value)
  options.noteGeometryRevision(snapshot.geometryRevision)
  return snapshot
}
