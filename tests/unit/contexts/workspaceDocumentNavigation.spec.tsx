import { act, renderHook } from '@testing-library/react'
import type { Node } from '@xyflow/react'
import { describe, expect, it, vi } from 'vitest'
import { useWorkspaceDocumentNavigation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentNavigation'
import type { WorkspaceDocumentOpeningArgs } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useWorkspaceDocumentOpening'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'

function node(id: string, uri?: string): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 0, y: 0 },
    data: {
      sessionId: id,
      title: id,
      width: 200,
      height: 200,
      kind: uri ? 'document' : 'terminal',
      status: null,
      startedAt: null,
      endedAt: null,
      exitCode: null,
      lastError: null,
      scrollback: null,
      workerBinding: { endpointId: 'remote', mountId: 'remote-mount' },
      agent: null,
      task: null,
      note: null,
      image: null,
      website: null,
      document: uri ? { uri } : null,
    },
  }
}

function fixture() {
  const uri = 'file:///repo/main.ts'
  const terminal = node('terminal')
  const remoteDocument = node('remote-document', uri)
  const localDocument = node('local-document', uri)
  const nodesRef = { current: [terminal, remoteDocument, localDocument] }
  const spacesRef = {
    current: [
      {
        id: 'local-space',
        targetMountId: 'local-mount',
        nodeIds: ['terminal', 'local-document'],
        rect: { x: 0, y: 0, width: 600, height: 600 },
      },
      {
        id: 'remote-space',
        targetMountId: 'remote-mount',
        nodeIds: ['remote-document'],
        rect: { x: 800, y: 0, width: 600, height: 600 },
      },
    ] as WorkspaceSpaceState[],
  }
  const createDocumentNode = vi.fn<WorkspaceDocumentOpeningArgs['createDocumentNode']>(() => null)
  const options: WorkspaceDocumentOpeningArgs & {
    workspaceId: string
    openSpaceExplorer: (spaceId: string) => void
    openExplorerSpaceId: string | null
  } = {
    workspaceId: 'workspace',
    nodesRef,
    spacesRef,
    setNodes: updater => {
      nodesRef.current = updater(nodesRef.current)
    },
    onSpacesChange: spaces => {
      spacesRef.current = spaces
    },
    createDocumentNode,
    reactFlow: {
      getZoom: () => 1,
      setCenter: vi.fn(),
      setViewport: vi.fn(),
    } as unknown as WorkspaceDocumentOpeningArgs['reactFlow'],
    openSpaceExplorer: vi.fn(),
    openExplorerSpaceId: null,
  }
  return { options, uri, createDocumentNode, terminal }
}

describe('workspace document navigation', () => {
  it('creates a local document at workspace root and reuses it on the next request', async () => {
    const { options, uri, createDocumentNode, terminal } = fixture()
    terminal.data.workerBinding = { endpointId: 'local', mountId: null }
    options.nodesRef.current = [terminal]
    options.spacesRef.current = []
    createDocumentNode.mockImplementation((anchor, document) => {
      const created = node('created-document', document.uri)
      created.position = anchor
      options.nodesRef.current = [...options.nodesRef.current, created]
      return created
    })
    const { result } = renderHook(() => useWorkspaceDocumentNavigation(options))
    await act(async () => {
      expect(await result.current.openFileLink('terminal', { uri, mountId: null, line: 9 })).toBe(
        true,
      )
    })
    const initialRequestId = result.current.navigationByNode.get('created-document')!.requestId
    await act(async () => {
      expect(await result.current.openFileLink('terminal', { uri, mountId: null, line: 15 })).toBe(
        true,
      )
    })
    expect(createDocumentNode).toHaveBeenCalledOnce()
    act(() => result.current.acknowledgeNavigation('created-document', initialRequestId))
    expect(result.current.navigationByNode.get('created-document')?.line).toBe(15)
  })

  it('reuses the document in the source mount and preserves line ranges outside node data', async () => {
    const { options, uri, createDocumentNode } = fixture()
    const { result } = renderHook(() => useWorkspaceDocumentNavigation(options))
    await act(async () => {
      expect(
        await result.current.openFileLink('terminal', {
          uri,
          mountId: 'remote-mount',
          line: 12,
          column: 3,
          lineEnd: 14,
          columnEnd: 8,
        }),
      ).toBe(true)
    })
    expect(createDocumentNode).not.toHaveBeenCalled()
    const intent = result.current.navigationByNode.get('remote-document')
    expect(intent).toMatchObject({
      uri,
      mountId: 'remote-mount',
      line: 12,
      column: 3,
      lineEnd: 14,
      columnEnd: 8,
    })
    expect(result.current.navigationByNode.has('local-document')).toBe(false)
    expect(options.nodesRef.current[1].data.document).toEqual({ uri })
    act(() => result.current.acknowledgeNavigation('remote-document', intent!.requestId))
    expect(result.current.navigationByNode.size).toBe(0)
  })

  it('rejects stale source mount requests and requests after the canvas has unmounted', async () => {
    const { options, uri } = fixture()
    const { result, unmount } = renderHook(() => useWorkspaceDocumentNavigation(options))
    expect(await result.current.openFileLink('terminal', { uri, mountId: 'local-mount' })).toBe(
      false,
    )
    const open = result.current.openFileLink
    unmount()
    expect(await open('terminal', { uri, mountId: 'remote-mount' })).toBe(false)
  })

  it('rejects a delayed callback from the previous workspace even when node ids are reused', async () => {
    const { options, uri } = fixture()
    const { result, rerender } = renderHook(
      ({ workspaceId }) => useWorkspaceDocumentNavigation({ ...options, workspaceId }),
      { initialProps: { workspaceId: 'first' } },
    )
    const previousOpen = result.current.openFileLink
    rerender({ workspaceId: 'second' })
    await act(async () => {
      expect(await previousOpen('terminal', { uri, mountId: 'remote-mount' })).toBe(false)
    })
  })

  it('removes pending jumps when the document closes', async () => {
    const { options, uri } = fixture()
    const { result, rerender } = renderHook(() => useWorkspaceDocumentNavigation(options))
    await act(async () => {
      await result.current.openFileLink('terminal', { uri, mountId: 'remote-mount', line: 12 })
    })
    options.nodesRef.current = options.nodesRef.current.filter(
      entry => entry.id !== 'remote-document',
    )
    rerender()
    expect(result.current.navigationByNode.size).toBe(0)
  })

  it('opens the exact directory in the source Space Explorer without creating a document', async () => {
    const { options, createDocumentNode } = fixture()
    options.openExplorerSpaceId = 'remote-space'
    const { result } = renderHook(() => useWorkspaceDocumentNavigation(options))
    await act(async () => {
      expect(
        await result.current.openFileLink('terminal', {
          uri: 'file:///repo/subdir',
          mountId: 'remote-mount',
          kind: 'directory',
        }),
      ).toBe(true)
    })
    expect(options.openSpaceExplorer).toHaveBeenCalledExactlyOnceWith('remote-space')
    expect(result.current.directoryTarget).toEqual({
      spaceId: 'remote-space',
      mountId: 'remote-mount',
      uri: 'file:///repo/subdir',
    })
    expect(createDocumentNode).not.toHaveBeenCalled()
  })

  it('discards pending file and directory navigation when the destination Space changes mounts', async () => {
    const { options, uri } = fixture()
    options.openExplorerSpaceId = 'remote-space'
    const { result, rerender } = renderHook(() => useWorkspaceDocumentNavigation(options))
    await act(async () => {
      await result.current.openFileLink('terminal', { uri, mountId: 'remote-mount', line: 12 })
      await result.current.openFileLink('terminal', {
        uri: 'file:///repo/subdir',
        mountId: 'remote-mount',
        kind: 'directory',
      })
    })
    expect(result.current.navigationByNode.size).toBe(1)
    expect(result.current.directoryTarget).not.toBeNull()
    options.spacesRef.current = options.spacesRef.current.map(space =>
      space.id === 'remote-space' ? { ...space, targetMountId: 'replacement-mount' } : space,
    )
    rerender()
    expect(result.current.navigationByNode.size).toBe(0)
    expect(result.current.directoryTarget).toBeNull()
  })
})
