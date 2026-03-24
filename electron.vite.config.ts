import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import type { Plugin } from 'vite'

export function buildCoveContentSecurityPolicy(isDev: boolean): string {
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
    `script-src ${scriptSources.join(' ')}`,
    `style-src ${styleSources.join(' ')}`,
    ...(styleAttributeSources ? [`style-src-attr ${styleAttributeSources.join(' ')}`] : []),
    ...(styleElementSources ? [`style-src-elem ${styleElementSources.join(' ')}`] : []),
    `img-src 'self' data: blob:`,
    `font-src 'self' data:`,
    `connect-src ${connectSources.join(' ')}`,
    `worker-src 'self' blob:`,
  ].join('; ')
}

function coveCspPlugin(): Plugin {
  return {
    name: 'cove:csp',
    transformIndexHtml(html, ctx) {
      const isDev = Boolean(ctx.server)
      const content = buildCoveContentSecurityPolicy(isDev)

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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/app/main/index.ts'),
          ptyHost: resolve(__dirname, 'src/platform/process/ptyHost/entry.ts'),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
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
        },
      },
    },
    plugins: [coveCspPlugin(), tailwindcss(), react()],
    resolve: {
      alias: {
        '@app': resolve(__dirname, 'src/app'),
        '@contexts': resolve(__dirname, 'src/contexts'),
        '@platform': resolve(__dirname, 'src/platform'),
        '@shared': resolve(__dirname, 'src/shared'),
      },
    },
  },
})
