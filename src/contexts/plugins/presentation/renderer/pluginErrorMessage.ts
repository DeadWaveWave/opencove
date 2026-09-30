/** Error descriptors cross Web JSON and Electron contextBridge differently. */
export function pluginErrorMessage(error: unknown): string {
  if (error && typeof error === 'object') {
    const descriptor = error as { debugMessage?: unknown; message?: unknown }
    if (typeof descriptor.debugMessage === 'string' && descriptor.debugMessage.trim()) {
      return descriptor.debugMessage.slice(0, 2000)
    }
    if (typeof descriptor.message === 'string') {
      return descriptor.message.slice(0, 2000)
    }
  }
  return String(error).slice(0, 2000)
}
