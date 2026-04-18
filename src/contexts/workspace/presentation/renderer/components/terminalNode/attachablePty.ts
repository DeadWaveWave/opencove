export type AttachablePtyApi = typeof window.opencoveApi.pty & {
  attach?: (payload: { sessionId: string }) => Promise<void>
  detach?: (payload: { sessionId: string }) => Promise<void>
}

export function resolveAttachablePtyApi(): AttachablePtyApi {
  return window.opencoveApi.pty as AttachablePtyApi
}
