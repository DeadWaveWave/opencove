import type { RendererAppErrorDescriptor } from '../errors/rendererAppError'
import type { ControlSurfaceInvokeRequest } from './controlSurface'

export type RendererBridgeResult<T> =
  | { __opencoveRendererBridge: 1; ok: true; value: T }
  | { __opencoveRendererBridge: 1; ok: false; error?: RendererAppErrorDescriptor }

type TransportReturn<T> =
  T extends Promise<infer Value> ? Promise<RendererBridgeResult<Value>> : RendererBridgeResult<T>
type TransportMember<T> = T extends (...args: infer Args) => infer Result
  ? (...args: Args) => TransportReturn<Result>
  : T extends object
    ? RendererBridgeApi<T>
    : T
export type RendererBridgeApi<T> = { [Key in keyof T]: TransportMember<T[Key]> }
/** Mapped types cannot preserve a generic callable; retain this contract explicitly. */
export type OpenCoveBridgeApi<T> = Omit<RendererBridgeApi<T>, 'controlSurface'> & {
  controlSurface: {
    resolvePluginResourceUrl: (path: string) => Promise<RendererBridgeResult<string>>
    invoke: <TValue = unknown>(
      request: ControlSurfaceInvokeRequest,
    ) => Promise<RendererBridgeResult<TValue>>
  }
}
