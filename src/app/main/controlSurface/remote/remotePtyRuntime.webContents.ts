import { webContents } from 'electron'

export function sendToWebContentsWindow(
  contentsId: number,
  channel: string,
  payload: unknown,
): boolean {
  const content = webContents.fromId(contentsId)
  if (!content || content.isDestroyed() || content.getType() !== 'window') {
    return false
  }

  try {
    content.send(channel, payload)
    return true
  } catch {
    return false
  }
}

export function sendToWebContentsAllWindows(channel: string, payload: unknown): void {
  for (const content of webContents.getAllWebContents()) {
    if (content.isDestroyed() || content.getType() !== 'window') {
      continue
    }

    try {
      content.send(channel, payload)
    } catch {
      // ignore send failures
    }
  }
}

export function sendToWebContentsSessionSubscribers(
  subscribersBySessionId: Map<string, Set<number>>,
  sessionId: string,
  channel: string,
  payload: unknown,
): number[] {
  const subscribers = subscribersBySessionId.get(sessionId)
  if (!subscribers || subscribers.size === 0) {
    return []
  }

  const delivered: number[] = []
  for (const contentsId of subscribers) {
    if (sendToWebContentsWindow(contentsId, channel, payload)) {
      delivered.push(contentsId)
    }
  }
  return delivered
}
