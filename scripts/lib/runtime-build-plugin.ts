import { resolve } from 'node:path'
import { normalizePath, type Plugin } from 'vite'
import { createRuntimeBuildIdentity } from './runtime-build-identity'

/** The same plugin is used by Electron builds and isolated Vite integration fixtures. */
export function runtimeBuildIdentityPlugin({
  root,
  development,
  serve,
  publish = false,
}: {
  root: string
  development: boolean
  serve: boolean
  publish?: boolean
}): Plugin {
  let identity = createRuntimeBuildIdentity(root, development)
  return {
    name: 'opencove:runtime-build',
    enforce: 'pre',
    buildStart() {
      identity = createRuntimeBuildIdentity(root, development)
      // Vite treats watch files added during transform as module imports.
      // Register the source tree at build scope so directories stay out of the module graph.
      for (const path of ['src', 'scripts', 'patches', 'package.json', 'pnpm-lock.yaml']) {
        this.addWatchFile(resolve(root, path))
      }
    },
    shouldTransformCachedModule({ id }) {
      return normalizePath(id).endsWith('/runtimeBuildIdentity.ts')
    },
    handleHotUpdate(ctx) {
      const modules =
        ctx.server.moduleGraph.getModulesByFile(
          normalizePath(resolve(root, 'src/shared/runtime/runtimeBuildIdentity.ts')),
        ) ?? new Set()
      for (const module of modules) {
        ctx.server.moduleGraph.invalidateModule(module)
      }
      return [...new Set([...ctx.modules, ...modules])]
    },
    transform(code, id) {
      if (!id.replaceAll('\\', '/').endsWith('/shared/runtime/runtimeBuildIdentity.ts')) {
        return null
      }
      if (serve) {
        identity = createRuntimeBuildIdentity(root, development)
      }
      return code
        .replace(/declare const __OPENCOVE_RUNTIME_BUILD__: unknown\s*/, '')
        .replaceAll('__OPENCOVE_RUNTIME_BUILD__', `(${JSON.stringify(identity)})`)
    },
    generateBundle() {
      if (publish) {
        this.emitFile({
          type: 'asset',
          fileName: 'runtime-build.json',
          source: JSON.stringify(identity),
        })
      }
    },
  }
}
