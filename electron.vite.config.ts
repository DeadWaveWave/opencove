import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'
import { createRuntimeBuildIdentity } from './scripts/lib/runtime-build-identity'

export function buildOpenCoveContentSecurityPolicy(isDev: boolean): string {
  const scriptSources = isDev ? ["'self'", "'unsafe-eval'"] : ["'self'"]
  const connectSources = isDev ? ["'self'", 'ws:', 'http:', 'https:'] : ["'self'"]
  const styleSources = isDev ? ["'self'", "'unsafe-inline'"] : ["'self'"]
  const styleAttributeSources = isDev ? null : ["'unsafe-inline'"]
  const styleElementSources = isDev ? null : ["'self'", "'unsafe-inline'"]

  return [
    `default-src 'self'`,
    `base-uri 'none'`,
    `form-action 'none'`,
    `frame-ancestors 'none'`,
    `object-src 'none'`,
    `frame-src 'self' http: https:`,
    `script-src ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    ...(styleAttributeSources ? [`style-src-attr ${styleAttributeSources.join(' ')}`] : []),
    ...(styleElementSources ? [`style-src-elem ${styleElementSources.join(' ')}`] : []),
    `img-src 'self' data: blob:`,
    `media-src 'self' blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSources.join(' ')}`,
    `worker-src 'self' blob:`,
  ].join('; ')
}

function opencoveCspPlugin(): Plugin {
  return {
    name: 'opencove:csp',
    transformIndexHtml(html, ctx) {
      const isDev = Boolean(ctx.server)
      const content = buildOpenCoveContentSecurityPolicy(isDev)

      return {
        html,
        tags: [
          {
            tag: 'meta',
            attrs: {
              'http-equiv': 'Content-Security-Policy',
              content,
            },
            injectTo: 'head',
          },
        ],
      }
    },
  }
}

export default defineConfig(({ command }) => {
  const development = command === 'serve' || process.env.OPENCOVE_BUILD_CHANNEL === 'dev'
  const runtimeIdentityPlugin = (publish = false): Plugin => {
    let identity = createRuntimeBuildIdentity(__dirname, development)
    return {
      name: 'opencove:runtime-build',
      enforce: 'pre',
      buildStart() {
        identity = createRuntimeBuildIdentity(__dirname, development)
      },
      shouldTransformCachedModule({ id }) {
        return id.endsWith('/runtimeBuildIdentity.ts')
      },
      handleHotUpdate(ctx) {
        const modules =
          ctx.server.moduleGraph.getModulesByFile(
            resolve(__dirname, 'src/shared/runtime/runtimeBuildIdentity.ts'),
          ) ?? new Set()
        for (const module of modules) ctx.server.moduleGraph.invalidateModule(module)
        return [...new Set([...ctx.modules, ...modules])]
      },
      transform(code, id) {
        if (!id.replaceAll('\\', '/').endsWith('/shared/runtime/runtimeBuildIdentity.ts'))
          return null
        for (const path of ['src', 'scripts', 'patches', 'package.json', 'pnpm-lock.yaml']) {
          this.addWatchFile(resolve(__dirname, path))
        }
        if (command === 'serve') identity = createRuntimeBuildIdentity(__dirname, development)
        return code
          .replace(/declare const __OPENCOVE_RUNTIME_BUILD__: unknown\s*/, '')
          .replaceAll('__OPENCOVE_RUNTIME_BUILD__', `(${JSON.stringify(identity)})`)
      },
      generateBundle() {
        if (publish)
          this.emitFile({
            type: 'asset',
            fileName: 'runtime-build.json',
            source: JSON.stringify(identity),
          })
      },
    }
  }
  return {
    main: {
      plugins: [externalizeDepsPlugin(), runtimeIdentityPlugin(true)],
      resolve: {
        alias: {
          '@app': resolve(__dirname, 'src/app'),
          '@contexts': resolve(__dirname, 'src/contexts'),
          '@platform': resolve(__dirname, 'src/platform'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      build: {
        outDir: 'out/main',
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/app/main/index.ts'),
            worker: resolve(__dirname, 'src/app/worker/index.ts'),
            managedRuntime: resolve(__dirname, 'src/app/managedRuntime/index.ts'),
            ptyHost: resolve(__dirname, 'src/platform/process/ptyHost/entry.ts'),
            windowsConsoleObserver: resolve(
              __dirname,
              'src/platform/process/ptyHost/windowsConsoleObserverEntry.ts',
            ),
          },
        },
      },
    },
    preload: {
      plugins: [externalizeDepsPlugin(), runtimeIdentityPlugin()],
      resolve: {
        alias: {
          '@app': resolve(__dirname, 'src/app'),
          '@contexts': resolve(__dirname, 'src/contexts'),
          '@platform': resolve(__dirname, 'src/platform'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
      build: {
        outDir: 'out/preload',
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/app/preload/index.ts'),
          },
        },
      },
    },
    renderer: {
      root: 'src/app/renderer',
      build: {
        outDir: 'out/renderer',
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/app/renderer/index.html'),
            web: resolve(__dirname, 'src/app/renderer/web.html'),
          },
        },
      },
      plugins: [runtimeIdentityPlugin(), opencoveCspPlugin(), tailwindcss(), react()],
      resolve: {
        alias: {
          '@app': resolve(__dirname, 'src/app'),
          '@contexts': resolve(__dirname, 'src/contexts'),
          '@platform': resolve(__dirname, 'src/platform'),
          '@shared': resolve(__dirname, 'src/shared'),
        },
      },
    },
  }
})
