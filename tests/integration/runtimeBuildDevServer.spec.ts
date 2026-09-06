// @vitest-environment node
import { resolve } from 'node:path'
import { createServer, normalizePath, type HmrContext, type Plugin } from 'vite'
import { describe, expect, it } from 'vitest'
import config from '../../electron.vite.config'
import { createRuntimeBuildIdentity } from '../../scripts/lib/runtime-build-identity'

describe('runtime build identity in the Vite development server', () => {
  it('serves the identity and invalidates its real module graph entry after a source update', async () => {
    const root = resolve(__dirname, '../..')
    const resolved =
      typeof config === 'function'
        ? await config({ command: 'serve', mode: 'development' })
        : config
    const plugin = resolved.renderer?.plugins?.find(
      value =>
        value &&
        typeof value === 'object' &&
        'name' in value &&
        value.name === 'opencove:runtime-build',
    ) as Plugin
    const server = await createServer({
      configFile: false,
      root,
      plugins: [plugin],
      logLevel: 'silent',
      optimizeDeps: { noDiscovery: true, include: [] },
      server: { middlewareMode: true, watch: null },
    })

    try {
      const identityPath = normalizePath(
        resolve(root, 'src/shared/runtime/runtimeBuildIdentity.ts'),
      )
      const url = `/@fs/${identityPath}`
      const first = await server.transformRequest(url)
      expect(first?.code).toContain(createRuntimeBuildIdentity(root, true).buildId)
      const module = await server.moduleGraph.getModuleByUrl(url)
      expect(module?.transformResult).toBe(first)
      expect([...module!.importedModules].map(dependency => dependency.file)).toEqual([
        normalizePath(resolve(root, 'src/shared/contracts/runtimeBuild.ts')),
      ])

      const hook = plugin.handleHotUpdate as (ctx: HmrContext) => unknown
      const invalidated = hook({
        file: normalizePath(resolve(root, 'src/app/worker/index.ts')),
        timestamp: Date.now(),
        modules: [],
        server,
        read: async () => '',
      })
      expect(invalidated).toContain(module)
      expect(module?.transformResult).toBeNull()
      const refreshed = await server.transformRequest(url)
      expect(refreshed).not.toBe(first)
      expect(refreshed?.code).toContain(createRuntimeBuildIdentity(root, true).buildId)
    } finally {
      await server.close()
    }
  })
})
