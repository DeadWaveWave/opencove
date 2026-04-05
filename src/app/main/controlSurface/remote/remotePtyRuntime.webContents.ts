import { webContents } from 'electron'

export function sendToWebContentsWindow(
  contentsId: number,
  channel: string,
  payload: unknown,
): void {
  const content = webContents.fromId(contentsId)
  if (!content || content.isDestroyed() || content.getType() !== 'window') {
    return
  }

  try {
    content.send(channel, payload)
  } catch {
    // ignore send failures
  }
}

export function sendToWebContentsSessionSubscribers(
  subscribersBySessionId: Map<string, Set<number>>,
  sessionId: string,
  channel: string,
  payload: unknown,
): void {
  const subscribers = subscribersBySessionId.get(sessionId)
  if (!subscribers || subscribers.size === 0) {
    return
  }

  for (const contentsId of subscribers) {
    sendToWebContentsWindow(contentsId, channel, payload)
  }
}
