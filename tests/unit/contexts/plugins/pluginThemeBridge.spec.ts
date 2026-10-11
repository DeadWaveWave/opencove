// @vitest-environment node
import { runInNewContext } from 'node:vm'
import { expect, it, vi } from 'vitest'
import { PLUGIN_BRIDGE_SCRIPT } from '../../../../src/contexts/plugins/infrastructure/pluginBridgeScript'

it('keeps view context and font resources stable across repeated theme events and releases them on retirement', async () => {
  const events = new Map<string, (event: unknown) => void>()
  const parent = { postMessage: vi.fn() }
  const fonts = new Set<unknown>()
  const created: unknown[] = []
  const styles = new Map<string, string>()
  class Face {
    constructor(readonly family: string) {
      created.push(this)
    }
    load = () => Promise.resolve(this)
  }
  class Socket {
    static OPEN = 1
    readyState = 1
    addEventListener() {}
    send() {}
    close() {}
  }
  const window = {
    addEventListener: (name: string, callback: (event: unknown) => void) =>
      events.set(name, callback),
    opencovePlugin: undefined as unknown as {
      onThemeChange: (callback: (...args: unknown[]) => void) => () => void
    },
  }
  const root = {
    dataset: {} as Record<string, string>,
    style: {
      setProperty: (name: string, value: string) => styles.set(name, value),
      removeProperty: (name: string) => styles.delete(name),
    },
  }
  runInNewContext(PLUGIN_BRIDGE_SCRIPT, {
    window,
    parent,
    URL,
    WebSocket: Socket,
    FontFace: Face,
    navigator: { sendBeacon: () => true },
    document: {
      currentScript: { src: 'http://localhost:9000/plugin-assets/lease/__opencove_bridge.js' },
      documentElement: root,
      fonts,
      querySelectorAll: () => [],
    },
    setTimeout,
    clearTimeout,
  })
  const message = (type: string, context: unknown) =>
    events.get('message')?.({
      source: parent,
      origin: 'http://localhost:9000',
      data: { channel: 'opencove-plugin-v1', type, context },
    })
  const context = {
    theme: 'dark',
    themeId: 'plugin:studio:night',
    baseThemeId: 'pixel',
    themeVersion: 1,
    tokens: { '--cove-font-ui': 'Studio Sans' },
    colors: { '--cove-accent': '#334455' },
    fonts: [{ family: 'Studio Sans', source: 'local("Arial")' }],
    nodeId: 'node-one',
  }
  const changed = vi.fn()
  window.opencovePlugin.onThemeChange(changed)
  message('init', context)
  message('theme', { ...context, tokens: { ...context.tokens, '--cove-ui-font-scale': '1.1' } })
  expect(created).toHaveLength(1)
  expect(fonts.size).toBe(1)
  expect(root.dataset.coveThemeId).toBe(context.themeId)
  expect(changed).toHaveBeenLastCalledWith(
    'dark',
    context.colors,
    expect.objectContaining({ nodeId: 'node-one', themeVersion: 1 }),
  )
  message('theme', {
    theme: 'light',
    themeId: 'light',
    baseThemeId: 'light',
    fonts: [],
    tokens: {},
    colors: {},
  })
  expect(fonts.size).toBe(0)
  expect(styles.size).toBe(0)
  events.get('pagehide')?.({})
  message('theme', context)
  await Promise.resolve()
  expect(fonts.size).toBe(0)
  expect(created).toHaveLength(1)
})
