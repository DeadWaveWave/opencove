import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import { runtimeBuildIdentityPlugin } from './scripts/lib/runtime-build-plugin'
import {
  MAIN_ENTRIES,
  PRELOAD_ENTRIES,
  RENDERER_HTML_ENTRIES,
  RENDERER_ROOT,
} from './scripts/lib/build-entries.mjs'

const resolveEntries = (entries: Record<string, string>): Record<string, string> =>
  Object.fromEntries(
    Object.entries(entries).map(([name, path]) => [name, resolve(__dirname, path)]),
  )

/** Keep installation ahead of shared Desktop/Web UI evaluation without installing in Web. */
export function desktopStartupChunk(id: string): string | undefined {
  const path = id.replaceAll('\\', '/')
  // Vite prepends this import ahead of source imports; it must not pull in the app graph.
  if (id === '\0vite/preload-helper.js') {
    return 'modulePreload'
  }
  if (path.endsWith('/src/app/renderer/bootstrap/desktopApiInstallation.ts')) {
    return 'desktopApiInstallation'
  }
  if (path.endsWith('/src/app/renderer/bootstrap/installDesktopOpenCoveApi.ts')) {
    return 'desktopBridge'
  }
  return undefined
}

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
    `img-src 'self' data: blob: https:`,
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
  const runtimeIdentityPlugin = (publish = false): Plugin =>
    runtimeBuildIdentityPlugin({
      root: __dirname,
      development,
      serve: command === 'serve',
      publish,
    })
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
          input: resolveEntries(MAIN_ENTRIES),
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
          input: resolveEntries(PRELOAD_ENTRIES),
        },
      },
    },
    renderer: {
      root: RENDERER_ROOT,
      build: {
        outDir: 'out/renderer',
        rollupOptions: {
          input: resolveEntries(RENDERER_HTML_ENTRIES),
          output: {
            manualChunks: desktopStartupChunk,
            onlyExplicitManualChunks: false,
          },
        },
      },
      plugins: [runtimeIdentityPlugin(), opencoveCspPlugin(), react()],
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
