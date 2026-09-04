import type { HomeWorkerWebUiConfigFile } from '../../domain/homeWorkerConfig'

export const DEFAULT_WEB_LISTENER_DRAIN_TIMEOUT_MS = 30_000
export const MAX_WEB_LISTENER_RESTORE_DELAY_MS = 15_000

export function webConfigsEqual(
  left: HomeWorkerWebUiConfigFile,
  right: HomeWorkerWebUiConfigFile,
): boolean {
  return (
    left.enabled === right.enabled &&
    left.port === right.port &&
    left.exposeOnLan === right.exposeOnLan &&
    left.passwordHash === right.passwordHash
  )
}

export function resolveWebBindHostname(config: HomeWorkerWebUiConfigFile): string {
  return config.exposeOnLan ? '0.0.0.0' : '127.0.0.1'
}

export function resolveWebPasswordHash(config: HomeWorkerWebUiConfigFile): string | null {
  return config.exposeOnLan ? config.passwordHash : null
}

export function toWebAccessError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

export function waitForWebAccessRestore(signal: AbortSignal, delayMs: number): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve(false)
      return
    }
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
