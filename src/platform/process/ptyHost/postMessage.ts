export interface PtyHostPostMessageTarget {
  postMessage(message: unknown, callback?: (error: Error | null) => void): void
}

export function postPtyHostMessage(
  child: PtyHostPostMessageTarget,
  message: unknown,
  onError: (error: unknown) => void = () => undefined,
): void {
  try {
    child.postMessage(message, error => {
      if (error) {
        onError(error)
      }
    })
  } catch (error) {
    onError(error)
  }
}

export function postIdentifiedPtyHostMessage<TChild extends PtyHostPostMessageTarget>(
  child: TChild | null,
  hostInstanceId: string | null,
  createMessage: (hostInstanceId: string) => unknown,
  onError: (child: TChild, error: unknown) => void,
): void {
  if (!child || !hostInstanceId) {
    return
  }
  postPtyHostMessage(child, createMessage(hostInstanceId), error => onError(child, error))
}
