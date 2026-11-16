import { act } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  useWorkspaceDocumentOpening,
  type WorkspaceDocumentOpeningArgs,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentOpening'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import type { NodeWorkerBinding } from '../../../src/shared/types/nodeWorkerBinding'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import {
  createCanvasDocumentHarness,
  renderInCanvasDocument,
} from '../../support/canvasDocumentHarness'
import { storeBackedChannelsOf } from '../../support/workspaceCanvasStoreHarness'

const mocks = vi.hoisted(() => ({ resolveBinding: vi.fn(), assign: vi.fn() }))
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemNodeBinding',
  async importOriginal => ({
    ...(await importOriginal<object>()),
    resolveFilesystemEntryBinding: mocks.resolveBinding,
  }),
)
vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useInteractions.spaceAssignment',
  () => ({ assignNodeToSpaceAndExpand: mocks.assign }),
)

const uri = 'file:///repo/readme.md'
const binding: NodeWorkerBinding = { endpointId: 'remote', mountId: 'remote-mount' }
const request = { uri, mountId: binding.mountId, spaceId: 'space', anchor: { x: 10, y: 20 } }

function documentNode(id: string, workerBinding = binding): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 10, y: 20 },
    data: {
      kind: 'document',
      title: 'readme.md',
      width: 400,
      height: 300,
      sessionId: '',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      agent: null,
      task: null,
      note: null,
      image: null,
      website: null,
      document: { uri },
      workerBinding,
    },
  }
}

const remoteSpace = (): WorkspaceSpaceState =>
  ({
    id: 'space',
    name: 'Remote',
    directoryPath: '/remote',
    labelColor: null,
    targetMountId: 'remote-mount',
    nodeIds: [],
    rect: { x: 0, y: 0, width: 800, height: 600 },
  }) as WorkspaceSpaceState

/**
 * The options of a document opening in workspace `workspaceId`, whose document is in the app store
 * with the remote Space. `nodesRef` and `spacesRef` are the store's own arrays, for the test to
 * seed and to read back; the hook reads the store through the canvas store's reader.
 */
function fixture(workspaceId = 'workspace') {
  const harness = createCanvasDocumentHarness({ workspaceId, spaces: [remoteSpace()] })
  const { nodesRef, spacesRef, setNodes } = storeBackedChannelsOf(workspaceId, harness.flush)
  const options: WorkspaceDocumentOpeningArgs & {
    nodesRef: typeof nodesRef
    spacesRef: typeof spacesRef
    harness: typeof harness
  } = {
    workspaceId,
    nodesRef,
    spacesRef,
    harness,
    setNodes,
    updateCanvasDocument: vi.fn(),
    createDocumentNode: vi.fn((_anchor, _document, _placement, workerBinding) => {
      const created = documentNode('new-document', workerBinding)
      nodesRef.current.push(created)
      spacesRef.current[0].nodeIds.push(created.id)
      return created
    }),
    reactFlow: {
      getZoom: () => 1,
      setCenter: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as WorkspaceDocumentOpeningArgs['reactFlow'],
  }
  return options
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.resolveBinding.mockResolvedValue(binding)
})

describe('shared document opening', () => {
  it('keeps the source binding and collapse-aware Space assignment instead of reusing a moved local file', async () => {
    const options = fixture()
    options.nodesRef.current.push(
      documentNode('local-document', { endpointId: 'local', mountId: null }),
    )
    options.spacesRef.current[0].nodeIds.push('local-document')
    const { result } = renderInCanvasDocument(() => useWorkspaceDocumentOpening(options), {
      workspaceId: options.workspaceId,
    })
    await act(async () => {
      expect((await result.current(request))?.id).toBe('new-document')
    })
    expect(options.createDocumentNode).toHaveBeenCalledWith(
      request.anchor,
      { uri },
      expect.any(Object),
      binding,
    )
    expect(mocks.assign).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace',
        targetSpaceId: 'space',
        updateCanvasDocument: options.updateCanvasDocument,
      }),
    )
    for (const channel of ['spacesRef', 'nodesRef', 'setNodes', 'onSpacesChange']) {
      expect(mocks.assign.mock.calls[0][0]).not.toHaveProperty(channel)
    }
    expect(options.harness.flush).toHaveBeenCalledOnce()
  })

  it('rechecks the destination after resolving a mount and never falls back to local', async () => {
    const options = fixture()
    let resolve!: (value: NodeWorkerBinding | null) => void
    mocks.resolveBinding.mockImplementation(
      () =>
        new Promise(value => {
          resolve = value
        }),
    )
    const { result } = renderInCanvasDocument(() => useWorkspaceDocumentOpening(options), {
      workspaceId: options.workspaceId,
    })
    const pending = result.current(request)
    options.spacesRef.current[0].targetMountId = 'replacement-mount'
    resolve(binding)
    expect(await pending).toBeNull()
    expect(options.createDocumentNode).not.toHaveBeenCalled()
    options.spacesRef.current[0].targetMountId = 'remote-mount'
    mocks.resolveBinding.mockResolvedValue(null)
    expect(await result.current(request)).toBeNull()
    expect(options.createDocumentNode).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent materialization after asynchronous binding resolution', async () => {
    const options = fixture()
    const { result } = renderInCanvasDocument(() => useWorkspaceDocumentOpening(options), {
      workspaceId: options.workspaceId,
    })
    await act(async () => {
      const [first, second] = await Promise.all([result.current(request), result.current(request)])
      expect(first?.id).toBe(second?.id)
    })
    expect(options.createDocumentNode).toHaveBeenCalledOnce()
  })

  it('rejects deferred materialization after unmount or a reused workspace identity changes', async () => {
    const options = fixture('first')
    useAppStore.setState(state => ({
      workspaces: [
        ...state.workspaces,
        { ...state.workspaces[0], id: 'second', nodes: [], spaces: [remoteSpace()] },
      ],
    }))
    let resolve!: (value: NodeWorkerBinding) => void
    mocks.resolveBinding.mockImplementation(
      () =>
        new Promise(value => {
          resolve = value
        }),
    )
    let shown = 'first'
    const { result, rerender, unmount } = renderInCanvasDocument(
      () => useWorkspaceDocumentOpening({ ...options, workspaceId: shown }),
      { workspaceId: () => shown },
    )
    const pending = result.current(request)
    shown = 'second'
    useAppStore.setState({ activeWorkspaceId: 'second' })
    rerender()
    resolve(binding)
    expect(await pending).toBeNull()
    const closing = result.current(request)
    unmount()
    resolve(binding)
    expect(await closing).toBeNull()
    expect(options.createDocumentNode).not.toHaveBeenCalled()
  })
})
