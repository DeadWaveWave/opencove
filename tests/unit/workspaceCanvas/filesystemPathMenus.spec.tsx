import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceDirectoryBrowserNavigation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowserNavigation'
import { WorkspaceContextSelectionMenuContent } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceContextMenuSelectionParts'
import { FilesystemNodesContext } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/FilesystemNodesContext'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

const writeText = vi.fn()
const copyLocalPath = vi.fn()
beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined)
  copyLocalPath.mockReset().mockRejectedValue(new Error('remote path is not a local workspace'))
  window.opencoveApi = {
    clipboard: { writeText },
    workspace: { copyPath: copyLocalPath },
  } as unknown as Window['opencoveApi']
})

describe('filesystem path menus', () => {
  it('copies the right-clicked breadcrumb without navigating or substituting the current directory', async () => {
    const onNavigate = vi.fn()
    render(
      <WorkspaceDirectoryBrowserNavigation
        rootUri="file:///worker/repo"
        currentUri="file:///worker/repo/docs/design"
        onNavigate={onNavigate}
      />,
    )
    const docs = screen.getByRole('button', { name: 'docs' })
    fireEvent.contextMenu(docs, { clientX: 30, clientY: 40 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'spaceExplorer.copyRelativePath' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('docs'))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(screen.queryByTestId('directory-breadcrumb-context-menu')).toBeNull()

    fireEvent.contextMenu(docs, { clientX: 30, clientY: 40 })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'spaceExplorer.copyAbsolutePath' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('/worker/repo/docs'))
    expect(copyLocalPath).not.toHaveBeenCalled()
    fireEvent.contextMenu(screen.getByRole('button', { name: 'repo' }))
    fireEvent.click(await screen.findByRole('menuitem', { name: 'spaceExplorer.copyRelativePath' }))
    await waitFor(() => expect(writeText).toHaveBeenLastCalledWith('.'))
  })

  it('opens breadcrumb path actions from the keyboard and copies source Windows paths', async () => {
    render(
      <WorkspaceDirectoryBrowserNavigation
        rootUri="file:///C:/work"
        currentUri="file:///C:/work/docs%20draft"
        onNavigate={vi.fn()}
      />,
    )
    const docs = screen.getByRole('button', { name: 'docs draft' })
    act(() => docs.focus())
    fireEvent.keyDown(docs, { key: 'F10', shiftKey: true })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'spaceExplorer.copyAbsolutePath' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('C:\\work\\docs draft'))
  })

  it.each(['document', 'folder'])(
    'adds both path actions to the shared %s node menu',
    async kind => {
      const copyNodePath = vi.fn(async () => {})
      const close = vi.fn()
      render(
        <FilesystemNodesContext
          value={{
            updateFolder: vi.fn(),
            openFile: vi.fn(),
            findBlockingOpenDocument: () => null,
            getNodePathUri: id => (id === kind ? 'file:///repo/docs' : null),
            copyNodePath,
          }}
        >
          <WorkspaceContextSelectionMenuContent
            nodeId={kind}
            createSpaceFromSelectedNodes={vi.fn()}
            openLabelColorSubmenu={vi.fn()}
            labelColorButtonRef={{ current: null }}
            isLabelColorSubmenuOpen={false}
            canConvertSelectedNoteToTask={false}
            isConvertSelectedNoteToTaskDisabled={false}
            convertSelectedNoteToTask={vi.fn()}
            clearNodeSelection={vi.fn()}
            closeContextMenu={close}
          />
        </FilesystemNodesContext>,
      )
      fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.copyRelativePath' }))
      expect(copyNodePath).toHaveBeenCalledWith(kind, true)
      fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.copyAbsolutePath' }))
      expect(copyNodePath).toHaveBeenCalledWith(kind, false)
      expect(close).toHaveBeenCalledTimes(2)
    },
  )
})
