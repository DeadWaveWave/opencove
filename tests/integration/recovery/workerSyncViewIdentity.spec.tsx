/* eslint-disable no-await-in-loop -- Refreshes are ordered lifecycle transitions for the same mounted views. */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import React, { type ReactNode } from 'react'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { useWorkerSyncStateUpdates } from '@app/renderer/shell/hooks/useWorkerSyncStateUpdates'
import { toShellWorkspaceState } from '@app/renderer/shell/hooks/useHydrateAppState.helpers'
import { WorkspaceCanvasNodeTypesProvider } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.context'
import { useWorkspaceCanvasNodeTypes } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes'
import { useWorkspaceCanvasActionRefs } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useActionRefs'
import { GenericPluginView } from '@contexts/plugins/presentation/renderer/GenericPluginView'
import { ensurePersistedWorkspace } from '@contexts/workspace/presentation/renderer/utils/persistence/ensure'
import { acceptPersistedStateSnapshot } from '@contexts/workspace/presentation/renderer/utils/persistence/accept'
import { requestCanonicalRefresh } from '@contexts/workspace/presentation/renderer/utils/persistence/canonicalRefresh'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import type { PluginManifest } from '@contexts/plugins/domain/pluginTypes'

vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodePosition',
  () => ({ useNodePosition: () => ({ x: 0, y: 0 }) }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/collapse/WindowCollapsePresentation',
  () => ({
    WindowCollapsePresentation: ({ children }: { children: ReactNode }) => <>{children}</>,
  }),
)
vi.mock('@contexts/workspace/presentation/renderer/components/shared/windowCommitProbe', () => ({
  useWindowNodeCommitProbe: () => {},
}))
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/TerminalDisplayAlignmentContext',
  () => ({ useTerminalDisplayAlignment: () => ({ terminalFontSize: 13 }) }),
)
vi.mock('@contexts/plugins/presentation/renderer/pluginViewBridge', () => ({
  bindPluginViewBridge: () => () => {},
}))
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.plugin',
  () => ({
    WorkspaceCanvasPluginNodeType: ({ id }: { id: string }) => (
      <GenericPluginView plugin={plugin} nodeId={id} />
    ),
  }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.website',
  () => ({
    WorkspaceCanvasWebsiteNodeType: ({
      id,
      browserSearchEngine,
      selectNode,
    }: {
      id: string
      browserSearchEngine: string
      selectNode: (id: string) => void
    }) => (
      <iframe
        sandbox=""
        title={id}
        onClick={() => selectNode(id)}
        data-engine={browserSearchEngine}
      />
    ),
  }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.terminal',
  () => ({
    WorkspaceCanvasTerminalNodeType: ({ id }: { id: string }) => (
      <input aria-label={id} defaultValue="live terminal" />
    ),
  }),
)
vi.mock(
  '@contexts/workspace/presentation/renderer/components/workspaceCanvas/nodeTypes.document',
  () => ({
    WorkspaceCanvasDocumentNodeType: ({ id }: { id: string }) => (
      <textarea aria-label={id} defaultValue="unsaved editor" />
    ),
  }),
)
const plugin: PluginManifest = {
  id: 'identity',
  displayName: 'Identity',
  version: '1.0.0',
  description: '',
  source: 'local',
  enabled: true,
  status: 'ready',
  revision: 'same',
  nodeKinds: ['identity'],
  actionBar: false,
  contextMenu: false,
}
const original = { state: useAppStore.getState(), api: window.opencoveApi }
let types: ReturnType<typeof useWorkspaceCanvasNodeTypes>['nodeTypes']
const selected: string[] = []
function Canvas() {
  const { workspaces, agentSettings } = useAppStore()
  const workspace = workspaces[0]
  const actions = useWorkspaceCanvasActionRefs()
  const composed = useWorkspaceCanvasNodeTypes({
    ...actions,
    spacesRef: { current: workspace.spaces },
    workspacePath: workspace.path,
    agentProviderOrder: agentSettings.agentProviderOrder,
    defaultProvider: agentSettings.defaultProvider,
    browserDefaultMode: agentSettings.browserDefaultMode,
    browserSearchEngine: agentSettings.browserSearchEngine,
    selectNode: id => selected.push(workspace.name + ':' + id),
    convertNoteToTask: () => false,
    setNodeLabelColorOverride: () => {},
  })
  types = composed.nodeTypes
  return (
    <WorkspaceCanvasNodeTypesProvider value={composed.nodeTypesParameters}>
      {workspace.nodes.map(node => {
        const View = types[node.type!]
        return <View key={node.id} id={node.id} data={node.data} />
      })}
    </WorkspaceCanvasNodeTypesProvider>
  )
}
function Shell() {
  useWorkerSyncStateUpdates({ enabled: true })
  return <Canvas />
}
afterEach(() => {
  cleanup()
  useAppStore.setState(original.state, true)
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value: original.api })
  vi.useRealTimers()
})
it('retains React types, live iframe and editor identities across canonical refreshes and preference updates', async () => {
  vi.useFakeTimers()
  selected.length = 0
  let revision = 1,
    opened = 0
  const state: PersistedAppState = {
    formatVersion: 1,
    activeWorkspaceId: 'views',
    settings: structuredClone(DEFAULT_AGENT_SETTINGS),
    workspaces: [
      ensurePersistedWorkspace({
        id: 'views',
        name: 'Views',
        path: '/tmp/views',
        spaces: [],
        nodes: [
          {
            id: 'plugin',
            kind: 'plugin',
            title: 'Clock',
            task: { pluginId: 'identity', schemaVersion: 1, repoPath: '/tmp/views', mountId: null },
          },
          {
            id: 'website',
            kind: 'website',
            title: 'Website',
            task: { url: 'https://example.test', sessionMode: 'shared' },
          },
          { id: 'terminal', kind: 'terminal', title: 'Terminal', sessionId: 'runtime' },
          {
            id: 'editor',
            kind: 'document',
            title: 'Editor',
            task: { uri: 'file:///tmp/views/readme.md' },
          },
        ].map(n => ({ ...n, width: 640, height: 520, position: { x: 0, y: 0 } })),
      })!,
    ],
  }
  const invoke = vi.fn(async ({ id }: { id: string }) =>
    id === 'plugin.view.open'
      ? { viewId: 'view-' + ++opened, resourcePath: '/view-' + opened, context: {} }
      : null,
  )
  const write = vi.fn(async () => ({ ok: true, level: 'full', bytes: 0, revision }))
  Object.defineProperty(window, 'opencoveApi', {
    configurable: true,
    value: {
      persistence: {
        readAppState: async () => ({ state: structuredClone(state), revision, recovery: null }),
        writeAppState: write,
      },
      controlSurface: {
        invoke,
        resolvePluginResourceUrl: async (url: string) => 'about:blank#' + url,
      },
    },
  })
  useAppStore.setState({
    workspaces: state.workspaces.map(workspace => toShellWorkspaceState(workspace)),
    activeWorkspaceId: 'views',
    agentSettings: state.settings,
  })
  acceptPersistedStateSnapshot({ state, revision, isPersisted: true })
  render(React.createElement(Shell))
  await act(async () => {})
  const initialTypes = types
  const initialWorkspace = useAppStore.getState().workspaces[0]
  await act(async () => {
    requestCanonicalRefresh({ reason: 'connect', minimumRevision: revision })
    await vi.advanceTimersByTimeAsync(200)
  })
  expect(useAppStore.getState().workspaces[0]).toBe(initialWorkspace)
  const frame = screen.getByTitle('Identity'),
    website = screen.getByTitle('website'),
    terminal = screen.getByLabelText('terminal'),
    editor = screen.getByLabelText('editor')
  fireEvent.change(editor, { target: { value: 'still unsaved' } })
  for (const reason of ['connect', 'merged', 'connect'] as const) {
    state.workspaces[0].name = 'Views ' + ++revision
    await act(async () => {
      requestCanonicalRefresh({ reason, minimumRevision: revision })
      await vi.advanceTimersByTimeAsync(200)
    })
    expect(useAppStore.getState().workspaces[0].name).toBe(state.workspaces[0].name)
    expect(screen.getByTitle('Identity')).toBe(frame)
    expect(screen.getByTitle('website')).toBe(website)
    expect(screen.getByLabelText('terminal')).toBe(terminal)
    expect(screen.getByLabelText('editor')).toBe(editor)
    expect(editor).toHaveValue('still unsaved')
    expect(types.pluginNode).toBe(initialTypes.pluginNode)
  }
  await act(async () => {
    useAppStore.getState().setAgentSettings(s => ({ ...s, browserSearchEngine: 'bing' }))
  })
  expect(screen.getByTitle('website')).toBe(website)
  expect(website).toHaveAttribute('data-engine', 'bing')
  fireEvent.click(website)
  expect(selected).toEqual([state.workspaces[0].name + ':website'])
  expect(opened).toBe(1)
})
