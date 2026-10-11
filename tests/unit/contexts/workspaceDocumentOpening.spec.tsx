import { act, renderHook } from '@testing-library/react'
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

function fixture() {
  const options: WorkspaceDocumentOpeningArgs = {
    workspaceId: 'workspace',
    nodesRef: { current: [] },
    spacesRef: {
      current: [
        {
          id: 'space',
          name: 'Remote',
          targetMountId: 'remote-mount',
          nodeIds: [],
          rect: { x: 0, y: 0, width: 800, height: 600 },
        } as WorkspaceSpaceState,
      ],
    },
    setNodes: update => {
      options.nodesRef.current = update(options.nodesRef.current)
    },
    onSpacesChange: vi.fn(),
    onRequestPersistFlush: vi.fn(),
    createDocumentNode: vi.fn((_anchor, _document, _placement, workerBinding) => {
      const created = documentNode('new-document', workerBinding)
      options.nodesRef.current.push(created)
      options.spacesRef.current[0].nodeIds.push(created.id)
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
    const { result } = renderHook(() => useWorkspaceDocumentOpening(options))
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
      expect.objectContaining({ workspaceId: 'workspace', targetSpaceId: 'space' }),
    )
    expect(options.onRequestPersistFlush).toHaveBeenCalledOnce()
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
    const { result } = renderHook(() => useWorkspaceDocumentOpening(options))
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
    const { result } = renderHook(() => useWorkspaceDocumentOpening(options))
    await act(async () => {
      const [first, second] = await Promise.all([result.current(request), result.current(request)])
      expect(first?.id).toBe(second?.id)
    })
    expect(options.createDocumentNode).toHaveBeenCalledOnce()
  })

  it('rejects deferred materialization after unmount or a reused workspace identity changes', async () => {
    const options = fixture()
    let resolve!: (value: NodeWorkerBinding) => void
    mocks.resolveBinding.mockImplementation(
      () =>
        new Promise(value => {
          resolve = value
        }),
    )
    const { result, rerender, unmount } = renderHook(
      ({ workspaceId }) => useWorkspaceDocumentOpening({ ...options, workspaceId }),
      { initialProps: { workspaceId: 'first' } },
    )
    const pending = result.current(request)
    rerender({ workspaceId: 'second' })
    resolve(binding)
    expect(await pending).toBeNull()
    const closing = result.current(request)
    unmount()
    resolve(binding)
    expect(await closing).toBeNull()
    expect(options.createDocumentNode).not.toHaveBeenCalled()
  })
})
