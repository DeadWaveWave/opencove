import type { OpenCoveApi } from './api'
import type { OpenCoveBridgeApi, RendererBridgeResult } from '../../shared/contracts/rendererBridge'
import { toRendererAppErrorDescriptor } from '../../shared/errors/rendererAppError'

export function createRendererBridge(api: OpenCoveApi): OpenCoveBridgeApi<OpenCoveApi> {
  const success = (value: unknown): RendererBridgeResult<unknown> => ({
    __opencoveRendererBridge: 1,
    ok: true,
    value,
  })
  const failure = (error: unknown): RendererBridgeResult<never> => ({
    __opencoveRendererBridge: 1,
    ok: false,
    error: toRendererAppErrorDescriptor(error),
  })
  function wrap(namespace: object): object {
    return Object.fromEntries(
      Object.entries(namespace).map(([key, value]) => {
        if (typeof value === 'function') {
          return [
            key,
            (...args: unknown[]) => {
              try {
                const result: unknown = Reflect.apply(value, namespace, args)
                return result instanceof Promise ? result.then(success, failure) : success(result)
              } catch (error) {
                return failure(error)
              }
            },
          ]
        }
        return [key, key === 'meta' || !value || typeof value !== 'object' ? value : wrap(value)]
      }),
    )
  }
  return wrap(api) as OpenCoveBridgeApi<OpenCoveApi>
}
