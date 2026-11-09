import type { PresentationSnapshotTerminalResult } from '@shared/contracts/dto'
import { containsMeaningfulTerminalDisplayContent } from './hydrationReplacement'

type ExpectedPresentationGeometry = {
  cols: number
  rows: number
  geometryRevision?: number | null
}

export function requestPresentationSnapshot(
  sessionId: string,
): Promise<PresentationSnapshotTerminalResult | null> {
  return typeof window.opencoveApi.pty.presentationSnapshot === 'function'
    ? window.opencoveApi.pty
        .presentationSnapshot({ sessionId })
        .then(snapshot => snapshot ?? null)
        .catch(() => null)
    : Promise.resolve(null)
}

export async function requestPresentationSnapshotAfterGeometry({
  sessionId,
  expectedGeometry,
  minAppliedSeqExclusive = null,
  requireMeaningfulSerializedScreen = false,
  requestSnapshot = requestPresentationSnapshot,
  wait = attempt =>
    new Promise<void>(resolve => {
      window.setTimeout(resolve, Math.min(50 + attempt * 25, 150))
    }),
  maxAttempts = 8,
}: {
  sessionId: string
  expectedGeometry: ExpectedPresentationGeometry | null
  minAppliedSeqExclusive?: number | null
  requireMeaningfulSerializedScreen?: boolean
  requestSnapshot?: (sessionId: string) => Promise<PresentationSnapshotTerminalResult | null>
  wait?: (attempt: number) => Promise<void>
  maxAttempts?: number
}): Promise<PresentationSnapshotTerminalResult | null> {
  const minAppliedSeq =
    typeof minAppliedSeqExclusive === 'number' && Number.isFinite(minAppliedSeqExclusive)
      ? Math.max(0, Math.floor(minAppliedSeqExclusive))
      : null

  if (expectedGeometry === null && minAppliedSeq === null && !requireMeaningfulSerializedScreen) {
    const snapshot = await requestSnapshot(sessionId)
    return snapshot?.sessionId === sessionId ? snapshot : null
  }

  const attemptRequest = async (
    attempt: number,
    bestSequenceFenceSnapshot: PresentationSnapshotTerminalResult | null,
  ): Promise<PresentationSnapshotTerminalResult | null> => {
    if (attempt >= maxAttempts) {
      return bestSequenceFenceSnapshot
    }

    const snapshot = await requestSnapshot(sessionId)
    if (!snapshot) {
      if (attempt < maxAttempts - 1) {
        await wait(attempt)
      }

      return attemptRequest(attempt + 1, bestSequenceFenceSnapshot)
    }

    const expectedRevision = expectedGeometry?.geometryRevision
    const snapshotRevision = snapshot.geometryRevision
    const hasRevisionFence =
      typeof expectedRevision === 'number' &&
      Number.isSafeInteger(expectedRevision) &&
      expectedRevision > 0
    const hasSnapshotRevision =
      typeof snapshotRevision === 'number' &&
      Number.isSafeInteger(snapshotRevision) &&
      snapshotRevision > 0
    const hasRequiredRevision =
      !hasRevisionFence || (hasSnapshotRevision && snapshotRevision >= expectedRevision)
    // A committed geometry is a revision fence, not a permanent size lock. A
    // concurrent appearance/controller commit may supersede it before delivery.
    const hasNewerCanonicalGeometry =
      hasRevisionFence && hasSnapshotRevision && snapshotRevision > expectedRevision
    const hasExpectedGeometry =
      snapshot.sessionId === sessionId &&
      hasRequiredRevision &&
      (expectedGeometry === null ||
        (snapshot.cols === expectedGeometry.cols && snapshot.rows === expectedGeometry.rows) ||
        hasNewerCanonicalGeometry)
    const hasRequiredOutput = minAppliedSeq === null || snapshot.appliedSeq > minAppliedSeq
    const hasRequiredScreen =
      !requireMeaningfulSerializedScreen ||
      containsMeaningfulTerminalDisplayContent(snapshot.serializedScreen)
    const nextSequenceFenceSnapshot =
      hasExpectedGeometry && hasRequiredOutput ? snapshot : bestSequenceFenceSnapshot

    if (hasExpectedGeometry && hasRequiredOutput && hasRequiredScreen) {
      return snapshot
    }

    if (attempt < maxAttempts - 1) {
      await wait(attempt)
    }

    return attemptRequest(attempt + 1, nextSequenceFenceSnapshot)
  }

  return attemptRequest(0, null)
}
