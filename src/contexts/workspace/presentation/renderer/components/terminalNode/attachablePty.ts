import type { AttachTerminalResult } from '@shared/contracts/dto'

export type AttachablePtyApi = typeof window.opencoveApi.pty & {
  attach?: (payload: {
    sessionId: string
    afterSeq?: number | null
  }) => Promise<AttachTerminalResult>
  detach?: (payload: { sessionId: string }) => Promise<void>
}

export function resolveAttachablePtyApi(): AttachablePtyApi {
  return window.opencoveApi.pty as AttachablePtyApi
}
