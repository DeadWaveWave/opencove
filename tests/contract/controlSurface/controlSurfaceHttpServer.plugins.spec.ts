// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import {
  createInMemoryPersistenceStore,
  invoke,
} from './controlSurfaceHttpServer.sessionStreaming.testUtils'

describe('independent plugin control surface and asset leases', () => {
  it('authenticates installation and scopes/revokes asset-only access on private and Web listeners', async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-plugin-http-'))
    const source = join(root, 'source')
    await mkdir(join(source, 'ui'), { recursive: true })
    await writeFile(
      join(source, 'opencove.plugin.json'),
      JSON.stringify({
        apiVersion: 1,
        id: 'clock',
        version: '1.0.0',
        displayName: 'Clock',
        description: 'Clock fixture',
        engines: { opencove: '>=0.3.2 <0.4.0' },
        view: { entry: 'ui/index.html' },
      }),
    )
    await writeFile(
      join(source, 'ui/index.html'),
      '<!doctype html><html><head><script src="app.js"></script></head><body>Fixture plugin</body></html>',
    )
    await writeFile(join(source, 'ui/app.js'), 'window.clock = true')
    const runtime = createControlSurfaceHttpRuntime({
      userDataPath: join(root, 'profile'),
      appVersion: '0.3.2',
      token: 'private-host-secret',
      approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
      createPersistenceStore: async () => createInMemoryPersistenceStore(),
      ptyRuntime: {
        spawnSession: async () => ({ sessionId: 'unused' }),
        write: () => undefined,
        resize: () => undefined,
        kill: () => undefined,
        onData: () => () => undefined,
        onExit: () => () => undefined,
      },
    })
    try {
      await runtime.ready
      const privateListener = runtime.listen({
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'private',
        enableWebShell: false,
        webUiPasswordHash: null,
      })
      const webListener = runtime.listen({
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 0,
        role: 'web',
        enableWebShell: true,
        webUiPasswordHash: null,
      })
      const privateAddress = await privateListener.ready
      const webAddress = await webListener.ready
      const origin = `http://127.0.0.1:${privateAddress.port}`
      const webOrigin = `http://127.0.0.1:${webAddress.port}`
      const call = (id: string, payload: unknown, kind: 'command' | 'query' = 'command') =>
        invoke(origin, 'private-host-secret', { kind, id, payload })
      const unauthenticated = await fetch(`${origin}/invoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          kind: 'command',
          id: 'plugin.install',
          payload: { directory: source },
        }),
      })
      expect(unauthenticated.status).toBe(401)
      expect((await call('plugin.install', { directory: source })).data).toMatchObject({
        ok: true,
        value: { id: 'clock', source: 'local' },
      })
      expect(
        (await call('plugin.list', null, 'query')).data.value.plugins.map(
          (item: { id: string }) => item.id,
        ),
      ).toContain('clock')
      const invalid = await call('plugin.install', { directory: source })
      expect(invalid.data).toMatchObject({
        ok: false,
        error: {
          code: 'plugin.operation_failed',
          params: { reason: expect.stringContaining('already installed') },
        },
      })
      const opened = (await call('plugin.view.open', { pluginId: 'clock', nodeId: 'clock-node' }))
        .data.value
      expect(
        (await call('plugin.view.setTitle', { viewId: opened.viewId, title: 'Reading' })).data,
      ).toMatchObject({ ok: true })
      await Promise.all(
        ['', ' ', 'x'.repeat(201), 42].map(async title => {
          expect(
            (await call('plugin.view.setTitle', { viewId: opened.viewId, title })).data,
          ).toMatchObject({ ok: false, error: { code: 'plugin.operation_failed' } })
        }),
      )
      expect(opened.resourcePath).not.toContain('private-host-secret')
      await Promise.all(
        [origin, webOrigin].map(async base => {
          const response = await fetch(`${base}${opened.resourcePath}`)
          expect(response.status).toBe(200)
          const html = await response.text()
          expect(html.indexOf('__opencove_bridge.js')).toBeLessThan(html.indexOf('app.js'))
          expect(response.headers.get('referrer-policy')).toBe('no-referrer')
          expect(response.headers.get('content-security-policy')).not.toMatch(
            /style-src[^;]*unsafe-inline/,
          )
          expect(html).not.toContain('private-host-secret')
          expect(
            (await fetch(`${base}${opened.resourcePath.replace('ui/index.html', 'ui/app.js')}`))
              .status,
          ).toBe(200)
          expect((await fetch(`${base}/plugin-assets/invalid/ui/index.html`)).status).toBe(404)
          const traversal = await fetch(
            `${base}${opened.resourcePath.replace('ui/index.html', 'ui%2F..%2F..%2Foutside')}`,
          )
          expect(traversal.status).toBe(404)
          expect(await traversal.text()).not.toContain('root')
          const token = opened.resourcePath.split('/')[2]
          expect(
            (await invoke(base, token, { kind: 'query', id: 'plugin.list', payload: null })).status,
          ).toBe(401)
        }),
      )
      await call('plugin.storage.set', { viewId: opened.viewId, key: 'favorite', value: 'one' })
      expect(
        (await call('plugin.storage.get', { viewId: opened.viewId, key: 'favorite' }, 'query')).data
          .value,
      ).toBe('one')
      await call('plugin.view.close', { viewId: opened.viewId })
      expect(
        (await call('plugin.view.setTitle', { viewId: opened.viewId, title: 'Late' })).data,
      ).toMatchObject({ ok: false })
      expect((await fetch(`${origin}${opened.resourcePath}`)).status).toBe(404)
      const second = (await call('plugin.view.open', { pluginId: 'clock', nodeId: 'clock-node' }))
        .data.value
      await call('plugin.reload', { pluginId: 'clock' })
      expect((await fetch(`${origin}${second.resourcePath}`)).status).toBe(404)
      const third = (await call('plugin.view.open', { pluginId: 'clock', nodeId: 'clock-node' }))
        .data.value
      const closePath = third.resourcePath.replace('ui/index.html', '__close')
      expect((await fetch(`${webOrigin}${closePath}`, { method: 'POST' })).status).toBe(204)
      expect((await fetch(`${origin}${third.resourcePath}`)).status).toBe(404)
      expect((await fetch(`${webOrigin}${closePath}`, { method: 'POST' })).status).toBe(404)
      const fourth = (await call('plugin.view.open', { pluginId: 'clock', nodeId: 'clock-node' }))
        .data.value
      await call('plugin.uninstall', { pluginId: 'clock' })
      expect((await fetch(`${origin}${fourth.resourcePath}`)).status).toBe(404)
    } finally {
      await runtime.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
