import { posix, resolve } from 'node:path'
import { build } from 'vite'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { desktopStartupChunk } from '../../../electron.vite.config'

let entry: string
const chunks = new Map<string, string>()
beforeAll(async () => {
  // Execute the actual entry and installer; replace the UI graph with an eager API consumer.
  const result = await build({
    configFile: false,
    logLevel: 'silent',
    base: './',
    resolve: { alias: { '@shared': resolve('src/shared') } },
    plugins: [
      {
        name: 'desktop-startup-observations',
        enforce: 'pre',
        resolveId(id) {
          const name = id.split('/').at(-1)
          if (
            [
              'renderApp',
              'ensureRandomUuid',
              'installGlassGrain',
              'desktopAcceptanceHarness',
            ].includes(name ?? '') ||
            id === 'startup:app-consumer' ||
            id === 'startup:gallery' ||
            name === 'startup:web'
          ) {
            return `\0startup:${name}`
          }
        },
        load(id) {
          if (id === '\0startup:renderApp') {
            return `import 'startup:app-consumer';
              export function renderApp() {
                window.events.push('render');
                window.openGallery = () => import('startup:gallery');
              }`
          }
          if (id === '\0startup:startup:app-consumer') {
            return `import { RendererTransportError } from '@shared/errors/rendererTransportError';
              window.TransportError = RendererTransportError;
              window.events.push(typeof window.opencoveApi?.controlSurface.invoke === 'function'
              ? 'graph:ready' : 'graph:missing')`
          }
          if (id === '\0startup:startup:web') {
            return `import { ensureRandomUuid } from './ensureRandomUuid';
              import { installGlassGrain } from './installGlassGrain';
              import { renderApp } from './renderApp';
              ensureRandomUuid(); installGlassGrain(); renderApp()`
          }
          if (id === '\0startup:startup:gallery') {
            return `export const gallery = true`
          }
          if (id === '\0startup:desktopAcceptanceHarness') {
            return `window.events.push('harness:evaluate');
              export function installDesktopAcceptanceHarness() { window.harness() }`
          }
          for (const name of ['ensureRandomUuid', 'installGlassGrain']) {
            if (id === `\0startup:${name}`) {
              return `export function ${name}() { window.events.push('${name}') }`
            }
          }
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      // Inlining dynamic modules changes their evaluation order; retain separate harness chunks.
      rollupOptions: {
        input: { index: resolve('src/app/renderer/main.tsx'), web: 'startup:web' },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: '[name]-[hash].js',
          inlineDynamicImports: false,
          manualChunks: desktopStartupChunk,
          onlyExplicitManualChunks: false,
        },
      },
    },
  })
  const output = (Array.isArray(result) ? result[0] : result) as {
    output: Array<{ type: string; code: string; fileName: string; isEntry: boolean }>
  }
  for (const item of output.output.filter(candidate => candidate.type === 'chunk')) {
    chunks.set(item.fileName, item.code)
    if (item.isEntry && item.fileName.startsWith('index')) {
      entry = item.fileName
    }
  }
})
afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

let documentId = 0
async function evaluate({ isTest = false, fail = false, language = 'en', web = false } = {}) {
  document.body.innerHTML = '<div id="root"></div>'
  const events: string[] = []
  const reload = vi.fn()
  const harness = vi.fn(() => {
    throw Error('Harness unavailable')
  })
  const target = Object.assign(new EventTarget(), {
    events,
    harness,
    location: { reload },
    __opencoveBridge: fail
      ? undefined
      : { meta: { isTest }, controlSurface: { invoke: () => undefined } },
  })
  target.addEventListener('opencove:api-installed', () => {
    events.push('installed')
    queueMicrotask(() => events.push('checkpoint'))
  })
  vi.stubGlobal('window', target)
  vi.stubGlobal('navigator', { language })
  // Native ESM keeps static chunk dependency order; each data URL represents a fresh document.
  const urls = new Map<string, string>()
  const id = ++documentId
  function urlFor(file: string): string {
    const cached = urls.get(file)
    if (cached) {
      return cached
    }
    const source = chunks
      .get(file)!
      .replace(/(["'])(\.\/[^"']+\.js)\1/g, (_match, _quote, path) =>
        JSON.stringify(urlFor(posix.join(posix.dirname(file), path))),
      )
    const url = `data:text/javascript;base64,${Buffer.from(`// document ${id}\n${source}`).toString('base64')}`
    urls.set(file, url)
    return url
  }
  await import(/* @vite-ignore */ urlFor(web ? 'web.js' : entry))
  if (isTest && !fail && !web) {
    await vi.waitFor(() => expect(harness).toHaveBeenCalledOnce())
  }
  return { events, reload, harness }
}

it('keeps Desktop installation out of the shared Web app graph', async () => {
  const { events } = await evaluate({ web: true })
  expect(events).toEqual(['graph:missing', 'ensureRandomUuid', 'installGlassGrain', 'render'])
})

it.each([false, true])(
  'installs before eager app evaluation and renders in the entry task (isTest=%s)',
  async isTest => {
    const { events, harness } = await evaluate({ isTest })
    expect(events.slice(0, 5)).toEqual([
      'installed',
      'graph:ready',
      'ensureRandomUuid',
      'installGlassGrain',
      'render',
    ])
    // An installer microtask and even a failing harness cannot precede or replace first render.
    expect(events.indexOf('checkpoint')).toBeGreaterThan(events.indexOf('render'))
    if (isTest) {
      await vi.waitFor(() => expect(harness).toHaveBeenCalledOnce())
      expect(events.indexOf('harness:evaluate')).toBeGreaterThan(events.indexOf('render'))
    } else {
      expect(harness).not.toHaveBeenCalled()
      expect(events).not.toContain('harness:evaluate')
    }
    expect(document.getElementById('root')?.getAttribute('role')).not.toBe('alert')
  },
)

it.each([
  ['en', 'OpenCove could not start.', 'Reload window'],
  ['zh-CN', 'OpenCove 无法启动。', '重新加载'],
])(
  'shows the existing installer fallback with a working Reload button in %s',
  async (language, text, label) => {
    const { events, reload, harness } = await evaluate({ fail: true, isTest: true, language })
    expect(events).not.toContain('render')
    expect(events).not.toContain('ensureRandomUuid')
    expect(harness).not.toHaveBeenCalled()
    expect(document.getElementById('root')?.getAttribute('role')).toBe('alert')
    expect(document.getElementById('root')?.textContent).toContain(text)
    expect(document.body.textContent).not.toContain('RendererTransportError')
    const button = document.querySelector('button')!
    expect(button.textContent).toBe(label)
    button.click()
    expect(reload).toHaveBeenCalledOnce()
  },
)
