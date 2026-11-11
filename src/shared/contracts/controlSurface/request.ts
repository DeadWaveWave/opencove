export type ControlSurfaceOperationKind = 'query' | 'command'

export interface ControlSurfaceInvokeRequest {
  clientFeatures?: import('./clientFeatures').ControlSurfaceClientFeatures
  kind: ControlSurfaceOperationKind
  id: string
  payload: unknown
}
