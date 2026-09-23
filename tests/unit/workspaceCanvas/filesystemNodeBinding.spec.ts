import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  resolveFilesystemEntryBinding,
  resolveFilesystemNodeMountId,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/filesystemNodeBinding'
import { EMPTY_NODE_KIND_DATA } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useNodesStore.nodeData'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '@contexts/workspace/presentation/renderer/types'
import type { NodeWorkerBinding } from '@shared/types/nodeWorkerBinding'

function setApi(value: unknown): void {
  Object.defineProperty(window, 'opencoveApi', { configurable: true, value })
}

afterEach(() => setApi(undefined))

function data(workerBinding?: NodeWorkerBinding): TerminalNodeData {
  return {
    ...EMPTY_NODE_KIND_DATA,
    kind: 'folder',
    sessionId: '',
    title: 'docs',
    width: 480,
    height: 400,
    status: null,
    startedAt: null,
    endedAt: null,
    exitCode: null,
    lastError: null,
    scrollback: null,
    workerBinding,
  }
}

const spaces: WorkspaceSpaceState[] = [
  {
    id: 'destination-space',
    name: 'Destination',
    directoryPath: '/different/repo',
    targetMountId: 'destination-mount',
    labelColor: null,
    nodeIds: ['folder'],
    rect: null,
  },
]

const target = {
  mountId: 'source-mount',
  endpointId: 'source-worker',
  projectId: 'project',
  targetId: 'target',
  rootPath: '/remote/repo',
  rootUri: 'file:///remote/repo',
}

describe('filesystem node location authority', () => {
  it('keeps an explicit source binding when the node is moved to another Space', () => {
    expect(
      resolveFilesystemNodeMountId(
        'folder',
        data({ endpointId: 'source-worker', mountId: 'source-mount' }),
        spaces,
      ),
    ).toBe('source-mount')
    expect(
      resolveFilesystemNodeMountId('folder', data({ endpointId: 'local', mountId: null }), spaces),
    ).toBeNull()
  })

  it('marks a remote binding without its mount unavailable and preserves legacy Space fallback', () => {
    expect(
      resolveFilesystemNodeMountId(
        'folder',
        data({ endpointId: 'source-worker', mountId: null }),
        spaces,
      ),
    ).toBeUndefined()
    expect(resolveFilesystemNodeMountId('folder', data(), spaces)).toBe('destination-mount')
    expect(resolveFilesystemNodeMountId('unowned', data(), spaces)).toBeNull()
  })

  it('resolves and validates the source mount before returning the durable binding', async () => {
    const invoke = vi.fn().mockResolvedValue(target)
    setApi({ controlSurface: { invoke } })

    await expect(
      resolveFilesystemEntryBinding('source-mount', 'file:///remote/repo/docs'),
    ).resolves.toEqual({ endpointId: 'source-worker', mountId: 'source-mount' })
    expect(invoke).toHaveBeenCalledWith({
      kind: 'query',
      id: 'mountTarget.resolve',
      payload: { mountId: 'source-mount' },
    })
  })

  it.each([
    { ...target, mountId: 'different-mount' },
    { ...target, rootUri: 'file:///unrelated/repo' },
    { ...target, rootUri: 'file://other/remote/repo' },
    null,
  ])('rejects a stale or mismatched source mount: %j', async resolved => {
    setApi({ controlSurface: { invoke: vi.fn().mockResolvedValue(resolved) } })
    await expect(
      resolveFilesystemEntryBinding('source-mount', 'file:///remote/repo/docs'),
    ).resolves.toBeNull()
  })

  it('rejects root escape and does not query another mount for a local reference', async () => {
    const invoke = vi.fn().mockResolvedValue(target)
    setApi({ controlSurface: { invoke } })
    await expect(
      resolveFilesystemEntryBinding('source-mount', 'file:///remote/repo/%2e%2e/private'),
    ).resolves.toBeNull()
    invoke.mockClear()
    await expect(resolveFilesystemEntryBinding(null, 'file:///local/repo')).resolves.toEqual({
      endpointId: 'local',
      mountId: null,
    })
    expect(invoke).not.toHaveBeenCalled()
  })
})
