import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import type { PluginViewContext } from '../domain/pluginRuntimeTypes'

interface PluginModule {
  activate(context: {
    pluginId: string
    dataDirectory: string
    log(message: string): void
  }): Promise<PluginInstance> | PluginInstance
}
interface PluginInstance {
  invoke(method: string, params: unknown, context: PluginViewContext): Promise<unknown> | unknown
  dispose?(): Promise<void> | void
}
let instance: PluginInstance | null = null
let stopped = false
let initializing = false
function send(value: unknown): void {
  if (process.connected) {
    process.send?.(value as object)
  }
}
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}
async function stop(): Promise<void> {
  if (stopped) {
    return
  }
  stopped = true
  try {
    await instance?.dispose?.()
  } finally {
    process.exit(0)
  }
}
process.once('disconnect', () => {
  void stop()
})
process.once('SIGTERM', () => {
  void stop()
})
process.once('SIGINT', () => {
  void stop()
})
process.on('message', async (raw: unknown) => {
  const request = record(raw)
  if (!request || stopped) {
    return
  }
  if (request.type === 'shutdown') {
    await stop()
    return
  }
  if (request.type === 'initialize' && !initializing) {
    initializing = true
    try {
      if (
        request.protocol !== 1 ||
        typeof request.entry !== 'string' ||
        typeof request.pluginId !== 'string' ||
        typeof request.dataDirectory !== 'string'
      ) {
        throw new Error('Invalid plugin initialization.')
      }
      await mkdir(request.dataDirectory, { recursive: true })
      const module = (await import(
        /* @vite-ignore */ pathToFileURL(request.entry).href
      )) as PluginModule
      if (typeof module.activate !== 'function') {
        throw new Error('Plugin main must export activate(context).')
      }
      instance = await module.activate({
        pluginId: request.pluginId,
        dataDirectory: request.dataDirectory,
        log: message => send({ type: 'log', message: String(message).slice(0, 4000) }),
      })
      if (!instance || typeof instance.invoke !== 'function') {
        throw new Error(
          'Plugin activate must return an object with invoke(method, params, viewContext).',
        )
      }
      if (stopped) {
        await instance.dispose?.()
        return
      }
      send({ type: 'ready', protocol: 1 })
    } catch (error) {
      send({ type: 'startup-error', error: error instanceof Error ? error.message : String(error) })
      process.exitCode = 1
      setTimeout(() => process.exit(1), 10)
    }
    return
  }
  if (request.type !== 'invoke' || typeof request.requestId !== 'string') {
    return
  }
  try {
    if (!instance || typeof request.method !== 'string' || !record(request.context)) {
      throw new Error('Plugin backend is not ready or request is invalid.')
    }
    const value = await instance.invoke(
      request.method,
      request.params,
      request.context as unknown as PluginViewContext,
    )
    const serialized = JSON.stringify(value ?? null)
    if (serialized.length > 2 * 1024 * 1024) {
      throw new Error('Plugin response exceeds 2 MiB.')
    }
    send({
      type: 'response',
      requestId: request.requestId,
      ok: true,
      value: JSON.parse(serialized),
    })
  } catch (error) {
    send({
      type: 'response',
      requestId: request.requestId,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    })
  }
})
