import { describe, expect, it } from 'vitest'
import { PluginViewRoutes } from '../../../../src/app/main/ipc/pluginViewRoutes'

describe('Desktop plugin view connection affinity', () => {
  it('keeps assets and RPC on the opening Worker without exposing its bearer or crossing clients', () => {
    const routes = new PluginViewRoutes()
    const endpoint = { hostname: '127.0.0.1', port: 1234, token: 'private-secret' }
    const opened = { viewId: 'view-one', resourcePath: '/plugin-assets/lease-one/ui/index.html' }
    routes.remember(7, opened, endpoint)
    endpoint.port = 5678
    expect(routes.resourceUrl(7, opened.resourcePath)).toBe(
      'http://127.0.0.1:1234/plugin-assets/lease-one/ui/index.html',
    )
    expect(routes.resourceUrl(7, opened.resourcePath)).not.toContain('private-secret')
    const call = {
      kind: 'command' as const,
      id: 'plugin.invoke',
      payload: { viewId: opened.viewId },
    }
    expect(routes.forRequest(7, call)?.port).toBe(1234)
    expect(routes.forRequest(8, call)).toBeNull()
    expect(routes.forRequest(7, { ...call, id: 'plugin.host.request' })?.port).toBe(1234)
    expect(routes.forRequest(8, { ...call, id: 'plugin.host.request' })).toBeNull()
    expect(routes.forRequest(7, { ...call, id: 'plugin.view.setTitle' })?.port).toBe(1234)
    expect(routes.forRequest(8, { ...call, id: 'plugin.view.setTitle' })).toBeNull()
    expect(() => routes.resourceUrl(8, opened.resourcePath)).toThrow('unknown view')
    routes.release(8, opened.viewId)
    expect(routes.forRequest(7, call)).not.toBeNull()
    routes.release(7, opened.viewId)
    expect(routes.forRequest(7, call)).toBeNull()
  })

  it('releases all routes when their client disappears and formats IPv6 asset URLs', () => {
    const routes = new PluginViewRoutes()
    routes.remember(
      7,
      { viewId: 'one', resourcePath: '/plugin-assets/token/index.html' },
      { hostname: '::1', port: 1234, token: 'secret' },
    )
    expect(routes.resourceUrl(7, '/plugin-assets/token/index.html')).toBe(
      'http://[::1]:1234/plugin-assets/token/index.html',
    )
    expect(routes.removeClient(7).map(item => item.viewId)).toEqual(['one'])
    expect(() => routes.resourceUrl(7, '/plugin-assets/token/index.html')).toThrow('unknown view')
  })
})
