import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { PluginManifest } from '../../domain/pluginTypes'
import { usePluginCommands } from './usePluginCommands'

const plugin: PluginManifest = {
  id: 'commands',
  version: '1.0.0',
  revision: 'one',
  runtimeGeneration: 1,
  displayName: 'Commands',
  description: '',
  nodeKinds: ['commands'],
  actionBar: false,
  contextMenu: false,
  enabled: true,
  status: 'ready',
  commands: [
    { id: 'inspect', title: 'Inspect', description: 'Inspect selected view', target: 'window' },
  ],
}
const plugins = [plugin]
vi.mock('./usePluginRegistry', () => ({
  usePluginRegistry: () => ({ plugins }),
  getPluginManifest: () => plugin,
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

it('derives the command-center project from an explicitly selected view when no project is active', async () => {
  const invoke = vi.fn(async (request: { id: string }) =>
    request.id === 'plugin.window.list'
      ? {
          windows: [
            {
              nodeId: 'node-selected',
              projectId: 'project-selected',
              spaceId: null,
              title: 'Selected document',
              views: [{ nodeId: 'node-selected', viewId: 'view-selected', ready: true }],
            },
          ],
        }
      : null,
  )
  vi.stubGlobal('opencoveApi', { controlSurface: { invoke } })
  const { result } = renderHook(() => usePluginCommands({ surface: 'commandCenter' }))
  await waitFor(() => expect(result.current.items).toHaveLength(1))
  await act(async () => {
    await result.current.run(result.current.items[0])
  })
  expect(invoke).toHaveBeenLastCalledWith({
    kind: 'command',
    id: 'plugin.command.run',
    payload: {
      pluginId: 'commands',
      commandId: 'inspect',
      params: null,
      projectId: 'project-selected',
      nodeId: 'node-selected',
      viewId: 'view-selected',
      context: { surface: 'commandCenter', projectId: 'project-selected' },
      expectedRevision: 'one',
      expectedRuntimeGeneration: 1,
    },
  })
})
