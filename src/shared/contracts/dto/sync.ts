export interface GetSyncStateResult {
  revision: number
  state: unknown | null
}

export type SyncEventPayload =
  | {
      type: 'app_state.updated'
      revision: number
      operationId: string
    }
  | {
      type: 'resync_required'
      revision: number
    }

export interface WriteSyncStateInput {
  state: unknown
  baseRevision?: number | null
}

export interface WriteSyncStateResult {
  revision: number
}

export interface CreateNoteInput {
  spaceId: string
  text?: string | null
  title?: string | null
  x?: number | null
  y?: number | null
  width?: number | null
  height?: number | null
}

export interface CreateNoteResult {
  revision: number
  projectId: string | null
  spaceId: string
  nodeId: string
}
