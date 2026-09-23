import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Node } from '@xyflow/react'
import type {
  TerminalNodeData,
  WorkspaceSpaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { resolveFileUriRelativePath } from '../../../src/shared/utils/fileUriScope'
import { useFilesystemNodePaths } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/hooks/useFilesystemNodePaths'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const writeText = vi.fn()
const invoke = vi.fn()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  invoke.mockReset()
  window.opencoveApi = {
    clipboard: { writeText },
    controlSurface: { invoke },
  } as unknown as Window['opencoveApi']
})

function setup(data: Partial<TerminalNodeData>, spaces: WorkspaceSpaceState[] = []) {
  const node = {
    id: 'file',
    data: { kind: 'document', document: { uri: 'file:///repo/docs/a.md' }, ...data },
  } as Node<TerminalNodeData>
  const onShowMessage = vi.fn()
  const view = renderHook(
    ({ workspaceId }) =>
      useFilesystemNodePaths({
        workspaceId,
        workspacePath: '/repo',
        nodesRef: { current: [node] },
        spacesRef: { current: spaces },
        onShowMessage,
      }),
    { initialProps: { workspaceId: 'one' } },
  )
  return { ...view, onShowMessage }
}

describe('filesystem node copy path ownership', () => {
  it('copies a file relative to the local project and supports parent traversal', async () => {
    const view = setup({ document: { uri: 'file:///sibling/docs/a.md' } })
    await act(() => view.result.current.copyNodePath('file', true))
    expect(writeText).toHaveBeenCalledWith('../sibling/docs/a.md')
    await act(() => view.result.current.copyNodePath('file', false))
    expect(writeText).toHaveBeenLastCalledWith('/sibling/docs/a.md')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('keeps a folder relative to its source root after moving it into a different Space', async () => {
    const view = setup(
      {
        kind: 'folder',
        folder: {
          uri: 'file:///source/repo/docs',
          rootUri: 'file:///source/repo',
          viewMode: 'icons',
          expandedDirectoryUris: [],
        },
      },
      [{ id: 'other', nodeIds: ['file'], directoryPath: '/other' } as WorkspaceSpaceState],
    )
    await act(() => view.result.current.copyNodePath('file', true))
    expect(writeText).toHaveBeenCalledWith('docs')
  })

  it('uses the bound worker root even when a remote document is placed in a local Space', async () => {
    invoke.mockResolvedValue({
      mountId: 'remote',
      endpointId: 'worker',
      rootUri: 'file:///remote/repo',
    })
    const view = setup(
      {
        document: { uri: 'file:///remote/repo/docs/a.md' },
        workerBinding: { endpointId: 'worker', mountId: 'remote' },
      },
      [{ id: 'local', nodeIds: ['file'], directoryPath: '/repo' } as WorkspaceSpaceState],
    )
    await act(() => view.result.current.copyNodePath('file', true))
    expect(invoke).toHaveBeenCalledWith({
      kind: 'query',
      id: 'mountTarget.resolve',
      payload: { mountId: 'remote' },
    })
    expect(writeText).toHaveBeenCalledWith('docs/a.md')
  })

  it('never substitutes a local root when a remote binding is unavailable or mismatched', async () => {
    invoke.mockResolvedValue({
      mountId: 'different',
      endpointId: 'worker',
      rootUri: 'file:///repo',
    })
    const view = setup({ workerBinding: { endpointId: 'worker', mountId: 'remote' } })
    await act(() => view.result.current.copyNodePath('file', true))
    expect(writeText).not.toHaveBeenCalled()
    expect(view.onShowMessage).toHaveBeenCalledWith('spaceExplorer.copyRelativePathFailed', 'error')
  })

  it('cancels a pending root lookup when the project changes', async () => {
    let resolve!: (value: unknown) => void
    invoke.mockReturnValue(
      new Promise(done => {
        resolve = done
      }),
    )
    const view = setup({ workerBinding: { endpointId: 'worker', mountId: 'remote' } })
    let copying!: Promise<void>
    act(() => {
      copying = view.result.current.copyNodePath('file', true)
    })
    view.rerender({ workspaceId: 'two' })
    await act(async () => {
      resolve({ mountId: 'remote', endpointId: 'worker', rootUri: 'file:///repo' })
      await copying
    })
    expect(writeText).not.toHaveBeenCalled()
    expect(view.onShowMessage).not.toHaveBeenCalled()
  })

  it('does not manufacture relative paths across Windows drives or network hosts', () => {
    expect(resolveFileUriRelativePath('file:///C:/repo', 'file:///D:/docs/a.md')).toBeNull()
    expect(resolveFileUriRelativePath('file://one/share', 'file://two/share/a.md')).toBeNull()
    expect(resolveFileUriRelativePath('file://one/share', 'file://one/other/a.md')).toBeNull()
    expect(resolveFileUriRelativePath('file:///C:/repo/docs', 'file:///C:/repo/a.md')).toBe(
      '../a.md',
    )
  })
})
