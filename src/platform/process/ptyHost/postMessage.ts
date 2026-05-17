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
