import type {
  AttachTerminalResult,
  PresentationSnapshotTerminalResult,
} from '@shared/contracts/dto'
import type { AttachablePtyApi } from './attachablePty'
import { containsMeaningfulTerminalDisplayContent } from './hydrationReplacement'

export function resolvePresentationSnapshotAttachAfterSeq(
  snapshot: PresentationSnapshotTerminalResult | null,
): number | null {
  if (!snapshot || !containsMeaningfulTerminalDisplayContent(snapshot.serializedScreen)) {
    return null
  }

  return Number.isFinite(snapshot.appliedSeq) && snapshot.appliedSeq >= 0
    ? Math.floor(snapshot.appliedSeq)
    : null
}

export function attachAfterPresentationSnapshot(options: {
  ptyApi: AttachablePtyApi
  sessionId: string
  presentationSnapshotPromise: Promise<PresentationSnapshotTerminalResult | null>
}): Promise<AttachTerminalResult | undefined> {
  return options.presentationSnapshotPromise.then(async snapshot => {
    const afterSeq = resolvePresentationSnapshotAttachAfterSeq(snapshot)
    return await options.ptyApi.attach?.({
      sessionId: options.sessionId,
      ...(afterSeq === null ? {} : { afterSeq }),
    })
  })
}
