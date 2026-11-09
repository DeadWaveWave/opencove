import type { Terminal } from '@xterm/xterm'
import type { PresentationSnapshotTerminalResult } from '@shared/contracts/dto'
import { requestPresentationSnapshot } from './presentationSnapshotGeometry'
import {
  beginTerminalSnapshotApplication,
  getAcceptedTerminalGeometryRevision,
  markTerminalGeometryAccepted,
} from './terminalGeometryCoordinator'

export async function applyPresentationSnapshot({
  terminal,
  sessionId,
  snapshot,
  apply,
  onAccepted,
  isDisposed,
  refetch = requestPresentationSnapshot,
  maxAttempts = 8,
}: {
  terminal: Terminal
  sessionId: string
  snapshot: PresentationSnapshotTerminalResult
  apply: (snapshot: PresentationSnapshotTerminalResult) => Promise<string>
  onAccepted: (snapshot: PresentationSnapshotTerminalResult, rawSnapshot: string) => void
  isDisposed: () => boolean
  refetch?: (sessionId: string) => Promise<PresentationSnapshotTerminalResult | null>
  maxAttempts?: number
}): Promise<boolean> {
  const isCurrent = (candidate: PresentationSnapshotTerminalResult | null) => {
    if (!candidate || candidate.sessionId !== sessionId) {
      return false
    }
    const revision = getAcceptedTerminalGeometryRevision(terminal)
    return (
      revision === null ||
      (candidate.geometryRevision !== null &&
        candidate.geometryRevision !== undefined &&
        candidate.geometryRevision >= revision)
    )
  }
  const attempt = async (
    candidate: PresentationSnapshotTerminalResult | null,
    count: number,
  ): Promise<boolean> => {
    if (isDisposed() || count >= maxAttempts) {
      return false
    }
    // The queue fence itself is an async gap: validate AFTER it, immediately
    // before reset/resize/write, against current ACK/event truth.
    // writeTerminalAsync intentionally skips empty strings; use xterm's actual
    // callback fence here so previously queued mode writes have really drained.
    await new Promise<void>(resolve => terminal.write('', resolve))
    if (isDisposed()) {
      return false
    }
    if (candidate && isCurrent(candidate)) {
      const finish = beginTerminalSnapshotApplication(terminal)
      try {
        const rawSnapshot = await apply(candidate)
        if (isDisposed()) {
          return false
        }
        if (isCurrent(candidate)) {
          markTerminalGeometryAccepted(terminal, candidate.geometryRevision)
          onAccepted(candidate, rawSnapshot)
          return true
        }
      } finally {
        finish(!isDisposed())
      }
    }
    if (count + 1 >= maxAttempts || isDisposed()) {
      return false
    }
    return attempt(await refetch(sessionId), count + 1)
  }
  return attempt(snapshot, 0)
}
