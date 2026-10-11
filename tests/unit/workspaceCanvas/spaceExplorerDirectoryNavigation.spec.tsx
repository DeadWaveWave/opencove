import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSpaceExplorerOverlayBody } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceSpaceExplorerOverlayBody'
import { WorkspaceDirectoryBrowserNavigation } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowserNavigation'
import type { WorkspaceDirectoryBrowserProps } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowser'

vi.mock('../../../src/app/renderer/i18n', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}))

vi.mock(
  '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/WorkspaceDirectoryBrowser',
  () => ({
    WorkspaceDirectoryBrowser: (props: WorkspaceDirectoryBrowserProps) => (
      <div data-testid="browser" data-root={props.rootUri} data-current={props.currentUri}>
        <WorkspaceDirectoryBrowserNavigation
          rootUri={props.rootUri}
          currentUri={props.currentUri}
          onNavigate={props.onNavigate}
        />
      </div>
    ),
  }),
)

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  )
})
afterEach(() => vi.unstubAllGlobals())

function makeProps() {
  return {
    spaceId: 'space',
    spaceName: 'Source workspace',
    rootUri: 'file:///repo',
    mountId: 'remote-mount',
    rootResolveError: null,
    explorerClipboard: null,
    setExplorerClipboard: vi.fn(),
    findBlockingOpenDocument: vi.fn(() => null),
    onPreviewFile: vi.fn(),
    onOpenFile: vi.fn(),
    onDismissQuickPreview: vi.fn(),
    onClose: vi.fn(),
    createInputRef: React.createRef<HTMLInputElement>(),
    renameInputRef: React.createRef<HTMLInputElement>(),
    containerRef: React.createRef<HTMLElement>(),
    onWindowDragStart: vi.fn(),
  }
}

describe('terminal directory navigation in the space explorer', () => {
  it('keeps the root breadcrumb and view mode when navigating to a requested subdirectory', () => {
    const props = makeProps()
    const requestedDirectory = { uri: 'file:///repo/docs/design' }
    const { container, rerender } = render(
      <WorkspaceSpaceExplorerOverlayBody {...props} requestedDirectory={requestedDirectory} />,
    )
    expect(screen.getByTestId('browser')).toHaveAttribute('data-root', 'file:///repo')
    expect(screen.getByTestId('browser')).toHaveAttribute('data-current', requestedDirectory.uri)
    expect(container.querySelector('.workspace-space-explorer__title')).toHaveTextContent('design')
    fireEvent.click(screen.getByRole('button', { name: 'spaceExplorer.listView' }))
    fireEvent.click(screen.getByRole('button', { name: 'docs' }))
    expect(screen.getByTestId('browser')).toHaveAttribute('data-current', 'file:///repo/docs')
    fireEvent.click(screen.getByRole('button', { name: 'repo' }))
    expect(container.querySelector('.workspace-space-explorer__title')).toHaveTextContent(
      'Source workspace',
    )

    // Clicking the same terminal link again must navigate again, without remounting the browser.
    rerender(
      <WorkspaceSpaceExplorerOverlayBody
        {...props}
        requestedDirectory={{ uri: requestedDirectory.uri }}
      />,
    )
    expect(screen.getByTestId('browser')).toHaveAttribute('data-current', requestedDirectory.uri)
    expect(screen.getByRole('button', { name: 'spaceExplorer.listView' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(props.onDismissQuickPreview).toHaveBeenCalled()
  })

  it('does not replace the browsing root with an out-of-scope directory request', () => {
    const props = makeProps()
    const { rerender } = render(
      <WorkspaceSpaceExplorerOverlayBody
        {...props}
        requestedDirectory={{ uri: 'file:///elsewhere' }}
      />,
    )
    expect(screen.getByTestId('browser')).toHaveAttribute('data-current', 'file:///repo')
    rerender(
      <WorkspaceSpaceExplorerOverlayBody
        {...props}
        requestedDirectory={{ uri: 'file:///repo/docs' }}
      />,
    )
    expect(screen.getByTestId('browser')).toHaveAttribute('data-current', 'file:///repo/docs')
    rerender(
      <WorkspaceSpaceExplorerOverlayBody
        {...props}
        requestedDirectory={{ uri: 'file:///repo-other/docs' }}
      />,
    )
    expect(screen.getByTestId('browser')).toHaveAttribute('data-current', 'file:///repo/docs')
  })
})
