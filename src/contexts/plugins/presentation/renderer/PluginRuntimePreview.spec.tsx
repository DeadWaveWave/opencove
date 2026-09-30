import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import type { PluginManifest } from '../../domain/pluginTypes'
import * as registry from './usePluginRegistry'
import { PluginNodePreview } from './PluginNodePreview'

const { mounted, disposed } = vi.hoisted(() => ({ mounted: vi.fn(), disposed: vi.fn() }))
vi.mock('./GenericPluginView', () => ({
  GenericPluginView: ({ nodeId, preview }: { nodeId: string; preview: boolean }) => {
    const [count, setCount] = useState(0)
    useEffect(() => {
      mounted(nodeId, preview)
      return () => disposed(nodeId)
    }, [nodeId, preview])
    return (
      <button
        data-testid="sample-plugin-content"
        data-node-id={nodeId}
        onClick={() => setCount(value => value + 1)}
      >
        {count}
      </button>
    )
  },
}))
const plugin: PluginManifest = {
  id: 'preview-fixture',
  displayName: 'Media Fixture',
  version: '1.0.0',
  description: '',
  source: 'local',
  enabled: false,
  status: 'disabled',
  hasPreview: true,
  nodeKinds: ['media'],
  actionBar: true,
  contextMenu: true,
  view: { entry: './view.html', width: 500, height: 300, minWidth: 300, minHeight: 200 },
}
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  mounted.mockClear()
  disposed.mockClear()
})

describe('external plugin preview lifecycle', () => {
  it('starts only on request, preserves runtime through collapse, and disposes it on close without workspace writes', async () => {
    await applyUiLanguage('en')
    vi.spyOn(registry, 'usePluginManifest').mockReturnValue(plugin)
    const invoke = vi
      .fn()
      .mockResolvedValue({ plugin, readme: '', assets: {}, sourceDirectory: '/fixture', logs: [] })
    vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
    const changed = vi.fn()
    const unsubscribe = useAppStore.subscribe(changed)
    try {
      render(<PluginNodePreview pluginId={plugin.id} />)
      expect(mounted).not.toHaveBeenCalled()
      expect(screen.queryByTestId('plugin-runtime-preview-canvas')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Start preview' }))
      const content = await screen.findByTestId('sample-plugin-content')
      const firstId = content.getAttribute('data-node-id')!
      expect(mounted).toHaveBeenCalledWith(firstId, true)
      fireEvent.click(content)
      expect(content).toHaveTextContent('1')
      fireEvent.click(screen.getByTestId('node-collapse'))
      expect(screen.getByTestId('sample-plugin-content')).toBe(content)
      expect(content.closest('.cove-node-presentation__runtime')).toHaveAttribute('inert')
      expect(disposed).not.toHaveBeenCalled()
      fireEvent.click(screen.getByTestId('node-expand'))
      expect(content).toHaveTextContent('1')
      fireEvent.click(screen.getByTestId('plugin-preview-close'))
      await waitFor(() => expect(disposed).toHaveBeenCalledWith(firstId))
      expect(screen.queryByTestId('sample-plugin-content')).toBeNull()
      fireEvent.click(screen.getByRole('button', { name: 'Start preview' }))
      const next = await screen.findByTestId('sample-plugin-content')
      expect(next).toHaveTextContent('0')
      expect(next.getAttribute('data-node-id')).not.toBe(firstId)
      await act(async () => undefined)
      expect(changed).not.toHaveBeenCalled()
      expect(invoke.mock.calls.every(([input]) => input.id === 'plugin.details')).toBe(true)
    } finally {
      unsubscribe()
    }
  })

  it('keeps unavailable previews from mounting the runtime', async () => {
    vi.spyOn(registry, 'usePluginManifest').mockReturnValue({ ...plugin, hasPreview: false })
    render(<PluginNodePreview pluginId={plugin.id} />)
    expect(screen.queryByRole('button', { name: 'Start preview' })).toBeNull()
    expect(mounted).not.toHaveBeenCalled()
  })
})
