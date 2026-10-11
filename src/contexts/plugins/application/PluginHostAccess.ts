import { pluginJsonValue } from '../domain/pluginJsonValue'
import type { PluginHostPort } from '../domain/pluginHostTypes'
import type { PluginRuntimeState, PluginRuntimeView } from './PluginRuntimeState'
import { pluginRuntimeGeneration } from './PluginRuntimeState'

/** Binds host requests to the immutable runtime/view that issued them. */
export class PluginHostAccess {
  private port: PluginHostPort | null = null
  private readonly pending = new Map<string, number>()
  private readonly retired = new WeakSet<PluginRuntimeState>()
  constructor(private readonly runtimeIsCurrent: (runtime: PluginRuntimeState) => boolean) {}

  bind(port: PluginHostPort): void {
    if (this.port) {
      throw new Error('Plugin host is already configured.')
    }
    this.port = port
  }

  backend(runtime: PluginRuntimeState) {
    const ownerId = `backend:${pluginRuntimeGeneration(runtime)}`
    return {
      hostRequest: (operation: string, payload: unknown) =>
        this.request(runtime, ownerId, operation, payload),
      hostClosed: async () => {
        this.retired.add(runtime)
        await this.port?.retire(ownerId)
      },
    }
  }

  async view(
    view: PluginRuntimeView,
    isCurrent: () => boolean,
    operation: string,
    payload: unknown,
  ) {
    if (view.context.preview) {
      throw new Error('Preview cannot access project host capabilities.')
    }
    return this.request(view.runtime, `view:${view.id}`, operation, payload, isCurrent)
  }

  async closeView(viewId: string): Promise<void> {
    await this.port?.retire(`view:${viewId}`)
  }

  private async request(
    runtime: PluginRuntimeState,
    ownerId: string,
    operation: string,
    payload: unknown,
    isCurrent = () => true,
  ): Promise<unknown> {
    const assertActive = () => {
      if (
        this.retired.has(runtime) ||
        !this.runtimeIsCurrent(runtime) ||
        !isCurrent() ||
        !runtime.record.enabled ||
        runtime.error
      ) {
        throw new Error('Plugin host context is no longer active.')
      }
    }
    assertActive()
    if (!this.port) {
      throw new Error('Plugin host capabilities are unavailable.')
    }
    const count = this.pending.get(ownerId) ?? 0
    if (count >= 128) {
      throw new Error('Too many pending plugin host requests.')
    }
    this.pending.set(ownerId, count + 1)
    try {
      const value = await this.port.request(
        { ownerId, pluginId: runtime.record.package.id, assertActive },
        operation,
        payload,
      )
      assertActive()
      return pluginJsonValue(value, 2 * 1024 * 1024, 'host response')
    } finally {
      const remaining = (this.pending.get(ownerId) ?? 1) - 1
      if (remaining) {
        this.pending.set(ownerId, remaining)
      } else {
        this.pending.delete(ownerId)
      }
    }
  }
}
