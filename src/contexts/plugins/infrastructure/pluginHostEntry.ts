import { mkdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { pluginJsonValue } from '../domain/pluginJsonValue.js'
import { PluginBackendHostClient } from './PluginBackendHostClient.js'
import type { PluginCommandContext, PluginViewContext } from '../domain/pluginRuntimeTypes'

interface PluginModule {
  activate(context: {
    pluginId: string
    dataDirectory: string
    log(message: string): void
    host: PluginBackendHostClient['api']
  }): Promise<PluginInstance> | PluginInstance
}
interface PluginInstance {
  invoke?(method: string, params: unknown, context: PluginViewContext): Promise<unknown> | unknown
  runCommand?(
    commandId: string,
    params: unknown,
    context: PluginCommandContext,
  ): Promise<unknown> | unknown
  dispose?(): Promise<void> | void
}
let instance: PluginInstance | null = null
let stopped = false
let initializing = false
let commandIds = new Set<string>()
let pluginId: string | null = null
const hostClient = new PluginBackendHostClient((message, failed) => {
  if (!process.connected || !process.send) {
    failed(new Error('OpenCove plugin host connection closed.'))
    return
  }
  process.send(message, failed)
})
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
  hostClient.close()
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
  if (request.type === 'host-response') {
    hostClient.receive(request)
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
        typeof request.dataDirectory !== 'string' ||
        !Array.isArray(request.commandIds) ||
        request.commandIds.some(id => typeof id !== 'string')
      ) {
        throw new Error('Invalid plugin initialization.')
      }
      await mkdir(request.dataDirectory, { recursive: true })
      commandIds = new Set(request.commandIds as string[])
      pluginId = request.pluginId
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
        host: hostClient.api,
      })
      if (
        !instance ||
        (typeof instance.invoke !== 'function' && typeof instance.runCommand !== 'function')
      ) {
        throw new Error('Plugin activate must return an object with invoke or runCommand.')
      }
      if (commandIds.size && typeof instance.runCommand !== 'function') {
        throw new Error('Plugin activate must return runCommand for declared plugin commands.')
      }
      if (stopped) {
        await instance.dispose?.()
        return
      }
      send({ type: 'ready', protocol: 1 })
    } catch (error) {
      hostClient.close()
      send({ type: 'startup-error', error: error instanceof Error ? error.message : String(error) })
      process.exitCode = 1
      setTimeout(() => process.exit(1), 10)
    }
    return
  }
  if (
    !['invoke', 'command'].includes(String(request.type)) ||
    typeof request.requestId !== 'string'
  ) {
    return
  }
  try {
    const context = record(request.context)
    if (
      !instance ||
      typeof request.method !== 'string' ||
      !context ||
      context.pluginId !== pluginId
    ) {
      throw new Error('Plugin backend is not ready or request is invalid.')
    }
    let value: unknown
    if (request.type === 'command') {
      if (!commandIds.has(request.method) || typeof instance.runCommand !== 'function') {
        throw new Error('Plugin command is not declared or its handler is unavailable.')
      }
      value = await instance.runCommand(
        request.method,
        request.params,
        request.context as unknown as PluginCommandContext,
      )
    } else {
      if (typeof instance.invoke !== 'function') {
        throw new Error('Plugin does not provide an invoke handler.')
      }
      value = await instance.invoke(
        request.method,
        request.params,
        request.context as unknown as PluginViewContext,
      )
    }
    const result = pluginJsonValue(value, 2 * 1024 * 1024, 'response (2 MiB limit)')
    send({
      type: 'response',
      requestId: request.requestId,
      ok: true,
      value: result,
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
