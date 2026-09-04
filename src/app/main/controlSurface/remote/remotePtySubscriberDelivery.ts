import { sendToWebContentsSessionSubscribers } from './remotePtyRuntime.webContents'
import type { RemotePtySessionCoordinator } from './remotePtyRuntime.sessionCoordinator'

type SubscriberDeliveryCoordinator = Pick<RemotePtySessionCoordinator, 'noteSubscriberSeq'> & {
  subscribersBySessionId: Map<string, Set<number>>
}

export function deliverRemotePtyToSubscribers(
  coordinator: SubscriberDeliveryCoordinator,
  sessionId: string,
  channel: string,
  payload: unknown,
): void {
  const delivered = sendToWebContentsSessionSubscribers(
    coordinator.subscribersBySessionId,
    sessionId,
    channel,
    payload,
  )
  const seq =
    payload && typeof payload === 'object' && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).seq
      : null
  if (typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0) {
    delivered.forEach(contentsId => coordinator.noteSubscriberSeq(sessionId, contentsId, seq))
  }
}
