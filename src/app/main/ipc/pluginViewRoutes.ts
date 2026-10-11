import type { ControlSurfaceInvokeRequest } from '../../../shared/contracts/controlSurface'
import type { ControlSurfaceRemoteEndpoint } from '../controlSurface/remote/controlSurfaceHttpClient'

interface ViewRoute {
  clientId: number
  viewId: string
  resourcePath: string
  endpoint: ControlSurfaceRemoteEndpoint
}

/** Transport affinity, not installation authority: an open view stays on its opening Worker. */
export class PluginViewRoutes {
  private readonly routes = new Map<string, ViewRoute>()

  remember(clientId: number, value: unknown, endpoint: ControlSurfaceRemoteEndpoint): void {
    if (!value || typeof value !== 'object') {
      return
    }
    const result = value as Record<string, unknown>
    if (typeof result.viewId !== 'string' || typeof result.resourcePath !== 'string') {
      return
    }
    if (!/^\/plugin-assets\/[a-zA-Z0-9-]+\//.test(result.resourcePath)) {
      return
    }
    this.routes.set(result.viewId, {
      clientId,
      viewId: result.viewId,
      resourcePath: result.resourcePath,
      endpoint: { ...endpoint },
    })
  }

  forRequest(
    clientId: number,
    request: ControlSurfaceInvokeRequest,
  ): ControlSurfaceRemoteEndpoint | null {
    if (
      ![
        'plugin.invoke',
        'plugin.host.request',
        'plugin.storage.get',
        'plugin.storage.set',
        'plugin.view.preferences.get',
        'plugin.view.preferences.set',
        'plugin.view.close',
        'plugin.view.setTitle',
      ].includes(request.id)
    ) {
      return null
    }
    const payload = request.payload as Record<string, unknown> | null
    if (!payload || typeof payload.viewId !== 'string') {
      return null
    }
    const route = this.routes.get(payload.viewId)
    return route?.clientId === clientId ? route.endpoint : null
  }

  resourceUrl(clientId: number, resourcePath: unknown): string {
    if (typeof resourcePath !== 'string') {
      throw new Error('Invalid plugin resource path.')
    }
    const route = [...this.routes.values()].find(
      item => item.clientId === clientId && item.resourcePath === resourcePath,
    )
    if (!route) {
      throw new Error('Plugin resource belongs to an expired or unknown view.')
    }
    const host = route.endpoint.hostname.includes(':')
      ? `[${route.endpoint.hostname}]`
      : route.endpoint.hostname
    return new URL(resourcePath, `http://${host}:${route.endpoint.port}`).href
  }

  release(clientId: number, viewId: unknown): void {
    if (typeof viewId === 'string' && this.routes.get(viewId)?.clientId === clientId) {
      this.routes.delete(viewId)
    }
  }

  removeClient(clientId: number): ViewRoute[] {
    const retired = [...this.routes.values()].filter(route => route.clientId === clientId)
    for (const route of retired) {
      this.routes.delete(route.viewId)
    }
    return retired
  }
  clear(): void {
    this.routes.clear()
  }
}
