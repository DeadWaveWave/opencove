import React, { useContext } from 'react'
import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import { useFilesystemNodes } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodes'
import { WorkspaceCanvasProviders } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/WorkspaceCanvasProviders'
import {
  WorkspaceDocumentNavigationContext,
  type WorkspaceDocumentNavigation,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/WorkspaceDocumentNavigationContext'
import { resolveSpaceExplorerPreviewDisplay } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer.helpers'
import { useCanvasSpaceExplorer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasSpaceExplorer'
import { useWorkspaceCanvasSpaceExplorer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer'
import { useWorkspaceDocumentOpening } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentOpening'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  CREATED,
  TARGET,
  expectsWriterOfTheRender,
  lastCall,
} from '../../support/pushAwayCallerHarness'

// The callers in the explorer, the document opening and the filesystem nodes hand the push-away the
// document writer of the render that made their callback, and none of the old channels (#702,
// PR 6). See `spaceAssignment.callers.spec.tsx`; the same checks, for the callers that need the
// filesystem mocks below.

const mocks = vi.hoisted(() => ({
  resolveBinding: vi.fn(),
  resolveFilesystem: vi.fn(),
}))

const firstRender = vi.hoisted(() => ({ values: new Map<string, unknown>() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/store/canvasStoreContext',
  async importOriginal => {
    const original = await importOriginal<Record<string, () => unknown>>()
    const stable = (name: string) => () => {
      const real = original[name]()
      if (!firstRender.values.has(name)) {
        firstRender.values.set(name, real)
      }
      return firstRender.values.get(name)
    }
    return {
      ...original,
      useCanvasUiCommands: stable('useCanvasUiCommands'),
      useCanvasDocumentCommands: stable('useCanvasDocumentCommands'),
      useReadCanvasUi: stable('useReadCanvasUi'),
      useReadCanvasSelection: stable('useReadCanvasSelection'),
    }
  },
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    assignNodeToSpaceAndExpand: vi.fn(),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemNodeBinding',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveFilesystemEntryBinding: mocks.resolveBinding,
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/utils/mountAwareFilesystemApi',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveFilesystemApiForMount: mocks.resolveFilesystem,
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer.helpers',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveSpaceExplorerPreviewDisplay: vi.fn(async () => ({
      kind: 'image',
      naturalWidth: 10,
      naturalHeight: 10,
      size: { width: 100, height: 100 },
    })),
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer.placement',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveFlowRectPlacement: vi.fn(() => ({
      rect: { x: 10, y: 10, width: 100, height: 100 },
      anchor: { x: 10, y: 10 },
      preferredDirection: 'right',
      avoidRects: [],
    })),
  }),
)

const assignMock = assignNodeToSpaceAndExpand as unknown as Mock
const assignArgs = () => lastCall(assignMock)[0] as Record<string, unknown> | undefined

const setNodes = vi.fn()
const onShowMessage = vi.fn()
const createDocumentNode = vi.fn(() => CREATED)
const createImageNode = vi.fn(() => CREATED)
const createFolderNode = vi.fn(() => CREATED)
const reactFlow = {
  getZoom: () => 1,
  setCenter: vi.fn(),
  setViewport: vi.fn(),
  screenToFlowPosition: () => ({ x: 400, y: 300 }),
}
const canvasRef = { current: document.createElement('div') }

beforeEach(() => {
  vi.clearAllMocks()
  firstRender.values.clear()
  mocks.resolveBinding.mockResolvedValue({ endpointId: 'local', mountId: null })
})

describe('the push-away of the document opening', () => {
  const request = {
    uri: 'file:///repo/readme.md',
    mountId: null,
    spaceId: 'target',
    anchor: { x: 400, y: 300 },
  }

  it('gives the opened document its workspace writer and flushes once after it', async () => {
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceDocumentOpening({
          workspaceId: 'workspace',
          setNodes,
          reactFlow,
          createDocumentNode,
          updateCanvasDocument,
        } as never),
      invoke: ({ hook }) => hook(request),
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})

describe('the push-away of the explorer', () => {
  it('gives the materialized image its workspace writer and flushes once after it', async () => {
    const api = window as unknown as { opencoveApi?: Record<string, unknown> }
    api.opencoveApi = { workspace: { writeCanvasImage: vi.fn(async () => undefined) } }
    mocks.resolveFilesystem.mockReturnValue({
      readFileBytes: vi.fn(async () => ({ bytes: new Uint8Array(3) })),
    })
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasSpaceExplorer({
          workspaceId: 'workspace',
          canvasRef,
          spaces: [TARGET],
          setNodes,
          reactFlow,
          nodeDragSession: {},
          finalizeDraggedNodeDrop: vi.fn(),
          createDocumentNode,
          createImageNode,
          standardWindowSizeBucket: 'regular',
          updateCanvasDocument,
        } as never),
      invoke: async ({ hook }) => {
        const before = assignMock.mock.calls.length
        hook.openFileInSpace('target', 'file:///repo/picture.png')
        await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
      },
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})

describe('the push-away of a text file opened from the explorer', () => {
  it('gives the opened document its workspace writer through the document opening', async () => {
    const documentPreview = {
      kind: 'document' as const,
      naturalWidth: undefined,
      naturalHeight: undefined,
      size: { width: 100, height: 100 },
    }
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useWorkspaceCanvasSpaceExplorer({
          workspaceId: 'workspace',
          canvasRef,
          spaces: [TARGET],
          setNodes,
          reactFlow,
          nodeDragSession: {},
          finalizeDraggedNodeDrop: vi.fn(),
          createDocumentNode,
          createImageNode,
          standardWindowSizeBucket: 'regular',
          updateCanvasDocument,
        } as never),
      invoke: async ({ hook }) => {
        vi.mocked(resolveSpaceExplorerPreviewDisplay).mockResolvedValueOnce(documentPreview)
        const before = assignMock.mock.calls.length
        hook.openFileInSpace('target', 'file:///repo/readme.md')
        await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
      },
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})

describe('the push-away of a document opened from a terminal link, through the Providers', () => {
  const source = {
    id: 'source',
    position: { x: 0, y: 0 },
    data: { kind: 'terminal', width: 100, height: 100, sessionId: 'session' },
  } as unknown as Node<TerminalNodeData>

  function NavigationProbe({
    capture,
  }: {
    capture: (navigation: WorkspaceDocumentNavigation) => void
  }): React.JSX.Element | null {
    capture(useContext(WorkspaceDocumentNavigationContext)!)
    return null
  }

  const sourceSpace = { ...TARGET, nodeIds: ['source'] }

  it('gives the opened document its workspace writer', async () => {
    await expectsWriterOfTheRender<WorkspaceDocumentNavigation>({
      assign: assignMock,
      seed: { nodes: [source], spaces: [sourceSpace] },
      element: (updateCanvasDocument, store, capture) => (
        <WorkspaceCanvasProviders
          nodeTypesParameters={{} as never}
          collapse={{ expandNode: vi.fn() } as never}
          openSpaceExplorer={vi.fn()}
          openExplorerSpaceId={null}
          workspaceId="workspace"
          workspacePath="/repo"
          nodeStore={{ ...store, updateCanvasDocument, createDocumentNode, createFolderNode }}
          onShowMessage={onShowMessage}
        >
          <NavigationProbe capture={capture} />
        </WorkspaceCanvasProviders>
      ),
      invoke: async ({ hook }) => {
        const before = assignMock.mock.calls.length
        await hook.openFileLink('source', {
          kind: 'file',
          uri: 'file:///repo/readme.md',
          mountId: null,
        } as never)
        expect(assignMock.mock.calls.length).toBeGreaterThan(before)
      },
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})

describe('the push-away through the explorer carrier of the canvas', () => {
  it('gives the materialized image its workspace writer and flushes once after it', async () => {
    const api = window as unknown as { opencoveApi?: Record<string, unknown> }
    api.opencoveApi = { workspace: { writeCanvasImage: vi.fn(async () => undefined) } }
    mocks.resolveFilesystem.mockReturnValue({
      readFileBytes: vi.fn(async () => ({ bytes: new Uint8Array(3) })),
    })
    const canvasState = { canvasRef }
    const agentSettings = { standardWindowSizeBucket: 'regular' }
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useCanvasSpaceExplorer({
          workspaceId: 'workspace',
          canvasState,
          nodeStore: {
            setNodes,
            updateCanvasDocument,
            createDocumentNode,
            createImageNode,
          },
          agentSettings,
          spaces: [TARGET],
          reactFlow,
          nodeDragSession: {},
          finalizeDraggedNodeDrop: vi.fn(),
        } as never),
      invoke: async ({ hook }) => {
        const before = assignMock.mock.calls.length
        hook.openFileInSpace('target', 'file:///repo/picture.png')
        await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
      },
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})

describe('the push-away of the filesystem nodes', () => {
  const folder = {
    id: 'folder',
    position: { x: 0, y: 0 },
    data: {
      kind: 'folder',
      width: 100,
      height: 100,
      folder: { uri: 'file:///repo', rootUri: 'file:///repo', viewMode: 'icons' },
    },
  } as unknown as Node<TerminalNodeData>

  it('gives the opened file its workspace writer and flushes once after it', async () => {
    mocks.resolveFilesystem.mockReturnValue({ stat: vi.fn(async () => ({ kind: 'file' })) })
    await expectsWriterOfTheRender({
      assign: assignMock,
      seed: { nodes: [folder], spaces: [TARGET] },
      useHook: updateCanvasDocument =>
        useFilesystemNodes({
          workspaceId: 'workspace',
          workspacePath: '/repo',
          nodeStore: { setNodes, createDocumentNode, createFolderNode, updateCanvasDocument },
          onShowMessage,
        } as never),
      invoke: async ({ hook }) => {
        const before = assignMock.mock.calls.length
        hook.actions.openFile('folder', 'file:///repo/readme.md')
        await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
      },
      argsOf: assignArgs,
      flush: 'document',
    })
  })
})
