// @vitest-environment node
import { copyFile, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer, normalizePath, type HmrContext, type ViteDevServer } from 'vite'
import { describe, expect, it } from 'vitest'
import { runtimeBuildIdentityPlugin } from '../../scripts/lib/runtime-build-plugin'
import { createRuntimeBuildIdentity } from '../../scripts/lib/runtime-build-identity'

describe('runtime build identity in the Vite development server', () => {
  it('serves the identity and invalidates its real module graph entry after a source update', async () => {
    // Exercise production fingerprinting without hashing the entire checkout.
    // Canonicalize macOS /var aliases just as Vite canonicalizes module paths.
    const root = await realpath(await mkdtemp(join(tmpdir(), 'opencove-runtime-dev-')))
    let server: ViteDevServer | undefined
    try {
      await Promise.all(
        ['src/shared/runtime', 'src/shared/contracts', 'src/app/worker', 'scripts', 'patches'].map(
          directory => mkdir(join(root, directory), { recursive: true }),
        ),
      )
      await Promise.all(
        ['src/shared/runtime/runtimeBuildIdentity.ts', 'src/shared/contracts/runtimeBuild.ts'].map(
          file => copyFile(resolve(__dirname, '../..', file), join(root, file)),
        ),
      )
      await writeFile(
        join(root, 'package.json'),
        JSON.stringify({ version: '1.0.0', type: 'module' }),
      )
      await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n')
      await writeFile(join(root, 'electron.vite.config.ts'), 'export default {}\n')
      const source = join(root, 'src/app/worker/index.ts')
      await writeFile(source, 'export const revision = 1\n')
      const plugin = runtimeBuildIdentityPlugin({ root, development: true, serve: true })
      server = await createServer({
        configFile: false,
        root,
        plugins: [plugin],
        logLevel: 'silent',
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, watch: null },
      })

      const identityPath = normalizePath(join(root, 'src/shared/runtime/runtimeBuildIdentity.ts'))
      const url = `/@fs/${identityPath}`
      const firstBuild = createRuntimeBuildIdentity(root, true)
      const first = await server.transformRequest(url)
      expect(first?.code).toContain(firstBuild.buildId)
      const module = await server.moduleGraph.getModuleByUrl(url)
      expect(module?.transformResult).toBe(first)
      expect([...module!.importedModules].map(dependency => dependency.file)).toEqual([
        normalizePath(join(root, 'src/shared/contracts/runtimeBuild.ts')),
      ])

      await writeFile(source, 'export const revision = 2\n')
      const hook = plugin.handleHotUpdate as (ctx: HmrContext) => unknown
      const invalidated = hook({
        file: normalizePath(source),
        timestamp: Date.now(),
        modules: [],
        server,
        read: async () => '',
      })
      expect(invalidated).toContain(module)
      expect(module?.transformResult).toBeNull()
      const refreshed = await server.transformRequest(url)
      const nextBuild = createRuntimeBuildIdentity(root, true)
      expect(nextBuild.buildId).not.toBe(firstBuild.buildId)
      expect(refreshed).not.toBe(first)
      expect(refreshed?.code).toContain(nextBuild.buildId)
      expect(refreshed?.code).not.toContain(firstBuild.buildId)
    } finally {
      try {
        await server?.close()
      } finally {
        await rm(root, { recursive: true, force: true })
      }
    }
  })
})
