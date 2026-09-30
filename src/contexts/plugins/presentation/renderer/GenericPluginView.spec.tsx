import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import type { PluginOpenViewResult } from '../../domain/pluginRuntimeTypes'
import { GenericPluginView } from './GenericPluginView'
import { bindPluginViewBridge } from './pluginViewBridge'

vi.mock('./pluginViewBridge', () => ({ bindPluginViewBridge: vi.fn(() => vi.fn()) }))
const plugin: PluginManifest = {
  id: 'lifecycle',
  displayName: 'Lifecycle',
  description: '',
  version: '1.0.0',
  revision: 'unchanged-artifact',
  source: 'local',
  enabled: true,
  status: 'ready',
  nodeKinds: ['lifecycle'],
  actionBar: true,
  contextMenu: true,
}
function view(number: number): PluginOpenViewResult {
  return {
    viewId: `lease-${number}`,
    resourcePath: `/plugin-assets/lease-${number}/view.html`,
    revision: plugin.revision!,
    context: {
      pluginId: plugin.id,
      nodeId: 'preview',
      workspaceId: null,
      directoryPath: null,
      preview: true,
    },
  }
}
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('generic plugin view leases', () => {
  it('reopens a preview on enablement and error recovery even when source revision stays unchanged', async () => {
    let opened = 0
    const invoke = vi.fn(async ({ id }: { id: string }) =>
      id === 'plugin.view.open' ? view(++opened) : null,
    )
    vi.stubGlobal('opencoveApi', {
      controlSurface: {
        invoke,
        resolvePluginResourceUrl: async (path: string) => `about:blank#${path}`,
      },
    })
    const { rerender } = render(<GenericPluginView plugin={plugin} nodeId="preview" preview />)
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-1/'),
      ),
    )
    expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
      'sandbox',
      'allow-scripts allow-same-origin allow-popups allow-downloads allow-forms',
    )
    rerender(
      <GenericPluginView
        plugin={{ ...plugin, description: 'metadata only' }}
        nodeId="preview"
        preview
      />,
    )
    expect(opened).toBe(1)
    rerender(
      <GenericPluginView
        plugin={{ ...plugin, enabled: false, status: 'disabled' }}
        nodeId="preview"
        preview
      />,
    )
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-2/'),
      ),
    )
    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'plugin.view.close',
      payload: { viewId: 'lease-1' },
    })
    rerender(<GenericPluginView plugin={plugin} nodeId="preview" preview />)
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-3/'),
      ),
    )
    rerender(
      <GenericPluginView
        plugin={{ ...plugin, status: 'error', error: 'Backend stopped' }}
        nodeId="preview"
        preview
      />,
    )
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-4/'),
      ),
    )
    rerender(<GenericPluginView plugin={plugin} nodeId="preview" preview />)
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-5/'),
      ),
    )
  })

  it('releases an outdated lease that arrives after a lifecycle transition', async () => {
    let finish: (value: PluginOpenViewResult) => void = () => undefined
    let opened = 0
    const invoke = vi.fn(({ id }: { id: string }) => {
      if (id !== 'plugin.view.open') {
        return Promise.resolve(null)
      }
      opened += 1
      return opened === 1
        ? new Promise(resolve => {
            finish = resolve
          })
        : Promise.resolve(view(2))
    })
    vi.stubGlobal('opencoveApi', {
      controlSurface: {
        invoke,
        resolvePluginResourceUrl: async (path: string) => `about:blank#${path}`,
      },
    })
    const { rerender } = render(<GenericPluginView plugin={plugin} nodeId="preview" preview />)
    rerender(
      <GenericPluginView
        plugin={{ ...plugin, enabled: false, status: 'disabled' }}
        nodeId="preview"
        preview
      />,
    )
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-2/'),
      ),
    )
    finish(view(1))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith({
        kind: 'command',
        id: 'plugin.view.close',
        payload: { viewId: 'lease-1' },
      }),
    )
    expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
      'src',
      expect.stringContaining('/lease-2/'),
    )
  })
  it('opens a fresh lease after a restored document announces its previous lease was released', async () => {
    let opened = 0
    const invoke = vi.fn(async ({ id }: { id: string }) =>
      id === 'plugin.view.open' ? view(++opened) : null,
    )
    vi.stubGlobal('opencoveApi', {
      controlSurface: {
        invoke,
        resolvePluginResourceUrl: async (path: string) => `about:blank#${path}`,
      },
    })
    render(<GenericPluginView plugin={plugin} nodeId="preview" preview />)
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-1/'),
      ),
    )
    const binding = vi.mocked(bindPluginViewBridge).mock.calls.at(-1)![0]
    act(() => binding.onRestore())
    await waitFor(() =>
      expect(screen.getByTitle('Lifecycle')).toHaveAttribute(
        'src',
        expect.stringContaining('/lease-2/'),
      ),
    )
    expect(invoke).toHaveBeenCalledWith({
      kind: 'command',
      id: 'plugin.view.close',
      payload: { viewId: 'lease-1' },
    })
  })
})
