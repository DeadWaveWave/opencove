import type { OpenCoveApi } from '../../preload/api'
import type { OpenCoveBridgeApi } from '@shared/contracts/rendererBridge'
import { reviveRendererAppError } from '@shared/errors/rendererAppError'
import { RendererTransportError } from '@shared/errors/rendererTransportError'
import { ownValue } from '@shared/errors/rendererErrorFields'

function unwrap(value: unknown): unknown {
  if (ownValue(value, '__opencoveRendererBridge') !== 1) {
    throw new RendererTransportError()
  }
  if (ownValue(value, 'ok') === true && Object.hasOwn(value as object, 'value')) {
    return ownValue(value, 'value')
  }
  if (ownValue(value, 'ok') === false) {
    throw reviveRendererAppError(ownValue(value, 'error'))
  }
  throw new RendererTransportError()
}
export function createDesktopOpenCoveApi(bridge: OpenCoveBridgeApi<OpenCoveApi>): OpenCoveApi {
  function wrap(namespace: object): object {
    return Object.fromEntries(
      Object.entries(namespace).map(([key, value]) => {
        if (typeof value === 'function') {
          return [
            key,
            (...args: unknown[]) => {
              let result: unknown
              try {
                result = Reflect.apply(value, namespace, args)
              } catch {
                throw new RendererTransportError()
              }
              return result instanceof Promise
                ? result.then(unwrap, () => {
                    throw new RendererTransportError()
                  })
                : unwrap(result)
            },
          ]
        }
        return [key, key === 'meta' || !value || typeof value !== 'object' ? value : wrap(value)]
      }),
    )
  }
  return wrap(bridge) as OpenCoveApi
}
const installed = new WeakSet<Window>()
export function installDesktopOpenCoveApi(target: Window = window): void {
  if (installed.has(target)) {
    return
  }
  if (!target.__opencoveBridge) {
    throw new RendererTransportError()
  }
  target.opencoveApi = createDesktopOpenCoveApi(target.__opencoveBridge)
  installed.add(target)
  target.dispatchEvent(new Event('opencove:api-installed'))
}
