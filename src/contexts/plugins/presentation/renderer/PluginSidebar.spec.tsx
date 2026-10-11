import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import { PluginSidebar } from './PluginSidebar'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), plugins: [] as PluginManifest[] }))
vi.mock('./usePluginRegistry', () => ({
  usePluginRegistry: () => ({ plugins: mocks.plugins }),
  getPluginManifest: (id: string) => mocks.plugins.find(plugin => plugin.id === id),
}))
vi.mock('./PluginIcon', () => ({ PluginIcon: () => <span /> }))
vi.mock('@app/renderer/i18n', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
beforeEach(() => {
  mocks.invoke.mockReset()
  window.opencoveApi = { controlSurface: { invoke: mocks.invoke } } as never
  mocks.plugins = [
    {
      id: 'p',
      displayName: 'Plugin',
      version: '1.0.0',
      description: 'Test',
      revision: 'r',
      runtimeGeneration: 1,
      status: 'ready',
      enabled: true,
      nodeKinds: [],
      actionBar: false,
      contextMenu: false,
      sidebar: [{ id: 'checks', title: 'Checks', itemsCommand: 'items' }],
    },
  ]
})
it('loads only an explicitly opened section and runs the chosen item with its exact project', async () => {
  mocks.invoke
    .mockResolvedValueOnce({
      items: [{ id: 'a', label: 'Run test', command: { id: 'run', params: { key: 1 } } }],
    })
    .mockResolvedValue(null)
  render(<PluginSidebar projectId="project-2" />)
  expect(mocks.invoke).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Checks' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Run test' }))
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(2))
  expect(mocks.invoke.mock.calls[0][0]).toMatchObject({
    id: 'plugin.sidebar.items',
    payload: { projectId: 'project-2', sectionId: 'checks' },
  })
  expect(mocks.invoke.mock.calls[1][0]).toEqual({
    kind: 'command',
    id: 'plugin.command.run',
    payload: {
      pluginId: 'p',
      commandId: 'run',
      params: { key: 1 },
      context: { surface: 'sidebar', projectId: 'project-2' },
      expectedRevision: 'r',
      expectedRuntimeGeneration: 1,
    },
  })
})
it('drops an old project response and removes disabled contributions without replaying anything', async () => {
  let resolve!: (value: unknown) => void
  mocks.invoke.mockImplementation(
    () =>
      new Promise(done => {
        resolve = done
      }),
  )
  const { rerender } = render(<PluginSidebar projectId="old" />)
  fireEvent.click(screen.getByRole('button', { name: 'Checks' }))
  rerender(<PluginSidebar projectId="new" />)
  await act(async () => resolve({ items: [{ id: 'a', label: 'Stale action' }] }))
  expect(screen.queryByText('Stale action')).toBeNull()
  expect(mocks.invoke).toHaveBeenCalledTimes(1)
  mocks.plugins[0].enabled = false
  rerender(<PluginSidebar projectId="new" />)
  expect(screen.queryByRole('button', { name: 'Checks' })).toBeNull()
})
