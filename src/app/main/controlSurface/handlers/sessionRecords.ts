import type { GetSessionResult } from '../../../../shared/contracts/dto'

export type SessionRoute =
  | {
      kind: 'local'
    }
  | {
      kind: 'remote'
      endpointId: string
      remoteSessionId: string
    }

export type SessionRecord = GetSessionResult & {
  startedAtMs: number
  route: SessionRoute
}
