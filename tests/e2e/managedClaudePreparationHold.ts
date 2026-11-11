import type { Page } from '@playwright/test'
import type { ControlSurfaceInvokeRequest } from '../../src/shared/contracts/controlSurface'
import type { PreparedRuntimeNodeResult } from '../../src/shared/contracts/dto'

/** Hold one genuine live prepare response across a newer authoritative commit. */
export async function holdPrepare(page: Page, nodeId: string) {
  await page.addInitScript(targetNodeId => {
    let api: typeof window.opencoveApi
    let held = false
    const originalAdd = EventSource.prototype.addEventListener
    EventSource.prototype.addEventListener = function (type, callback, options) {
      if (type !== 'opencove.sync' || !callback) {
        return originalAdd.call(this, type, callback, options)
      }
      return originalAdd.call(
        this,
        type,
        event => {
          if ((window as unknown as { __dropManagedSync?: boolean }).__dropManagedSync) {
            return
          }
          if (typeof callback === 'function') {
            callback.call(this, event)
          } else {
            callback.handleEvent(event)
          }
        },
        options,
      )
    }
    Object.defineProperty(window, 'opencoveApi', {
      configurable: true,
      get: () => api,
      set: value => {
        api = value
        const read = api.persistence.readAppState.bind(api.persistence)
        let priorRead: Awaited<ReturnType<typeof read>> | undefined
        api.persistence.readAppState = async () => {
          const probe = window as unknown as {
            __dropManagedSync?: boolean
            __correctedManagedWrite?: boolean
          }
          if (probe.__dropManagedSync && !probe.__correctedManagedWrite && priorRead) {
            return structuredClone(priorRead)
          }
          const snapshot = await read()
          if (probe.__dropManagedSync && !probe.__correctedManagedWrite && priorRead) {
            return structuredClone(priorRead)
          }
          priorRead = snapshot
          return snapshot
        }
        const write = api.persistence.writeAppState.bind(api.persistence)
        api.persistence.writeAppState = async payload => {
          const receipt = await write(payload)
          // A stale save converges either through a gate correction or, after a revision
          // conflict, through the adapter's merged retry; both carry the canonical binding.
          if (receipt.ok && (receipt.corrected || receipt.merged)) {
            Object.assign(window, { __correctedManagedWrite: true })
          }
          return receipt
        }
        const invoke = api.controlSurface.invoke.bind(api.controlSurface)
        api.controlSurface.invoke = async <T>(request: ControlSurfaceInvokeRequest): Promise<T> => {
          const result = await invoke<T>(request)
          const prepared =
            request.id === 'session.prepareOrRevive'
              ? (result as { nodes?: PreparedRuntimeNodeResult[] })?.nodes?.find(
                  node => node.nodeId === targetNodeId,
                )
              : undefined
          if (!held && prepared) {
            held = true
            Object.assign(window, { __heldManagedPrepare: structuredClone(prepared) })
            await new Promise<void>(resolve =>
              Object.assign(window, { __releaseManagedPrepare: resolve }),
            )
          }
          return result
        }
      },
    })
  }, nodeId)
}

export async function releasePrepare(page: Page) {
  await page.evaluate(() => {
    const release = (window as unknown as { __releaseManagedPrepare?: () => void })
      .__releaseManagedPrepare
    release?.()
  })
}
