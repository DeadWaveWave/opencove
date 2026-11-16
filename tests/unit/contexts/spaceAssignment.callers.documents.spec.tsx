import type { Mock } from 'vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import { assignNodeToSpaceAndExpand } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment'
import { useFilesystemNodes } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodes'
import { useCanvasSpaceExplorer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useCanvasSpaceExplorer'
import { useWorkspaceCanvasSpaceExplorer } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useSpaceExplorer'
import { useWorkspaceDocumentOpening } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentOpening'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import {
  CREATED,
  TARGET,
  expectsWriterOfTheRender,
  lastCall,
  nodesRef,
  spacesRef,
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
const onSpacesChange = vi.fn()
const onShowMessage = vi.fn()
const onRequestPersistFlush = vi.fn()
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
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
          onRequestPersistFlush,
          reactFlow,
          createDocumentNode,
          updateCanvasDocument,
        } as never),
      invoke: ({ hook }) => hook(request),
      argsOf: assignArgs,
      flush: onRequestPersistFlush,
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
          spacesRef,
          nodesRef,
          setNodes,
          onSpacesChange,
          onRequestPersistFlush,
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
      flush: onRequestPersistFlush,
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
    const canvasState = { canvasRef, spacesRef }
    const agentSettings = { standardWindowSizeBucket: 'regular' }
    await expectsWriterOfTheRender({
      assign: assignMock,
      useHook: updateCanvasDocument =>
        useCanvasSpaceExplorer({
          workspaceId: 'workspace',
          canvasState,
          nodeStore: {
            nodesRef,
            setNodes,
            updateCanvasDocument,
            createDocumentNode,
            createImageNode,
          },
          agentSettings,
          spaces: [TARGET],
          onRequestPersistFlush,
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
      flush: onRequestPersistFlush,
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
    nodesRef.current = [folder]
    try {
      await expectsWriterOfTheRender({
        assign: assignMock,
        useHook: updateCanvasDocument =>
          useFilesystemNodes({
            workspaceId: 'workspace',
            workspacePath: '/repo',
            nodeStore: {
              nodesRef,
              setNodes,
              createDocumentNode,
              createFolderNode,
              updateCanvasDocument,
            },
            spacesRef,
            onSpacesChange,
            onRequestPersistFlush,
            onShowMessage,
          } as never),
        invoke: async ({ hook }) => {
          const before = assignMock.mock.calls.length
          hook.actions.openFile('folder', 'file:///repo/readme.md')
          await vi.waitFor(() => expect(assignMock.mock.calls.length).toBeGreaterThan(before))
        },
        argsOf: assignArgs,
        flush: onRequestPersistFlush,
      })
    } finally {
      nodesRef.current = []
    }
  })
})
