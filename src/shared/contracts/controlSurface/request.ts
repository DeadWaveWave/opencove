export type ControlSurfaceOperationKind = 'query' | 'command'

export interface ControlSurfaceInvokeRequest {
  kind: ControlSurfaceOperationKind
  id: string
  payload: unknown
}
