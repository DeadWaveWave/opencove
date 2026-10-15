import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { useTranslation } from '@app/renderer/i18n'
import { decodeUriPathname } from '../../DocumentNode.helpers'
import { FilesystemPathMenuItems } from './FilesystemPathMenuItems'
import {
  copyExplorerAbsolutePath,
  copyExplorerRelativePath,
} from './WorkspaceSpaceExplorerOverlay.clipboard'
import type { ShowWorkspaceCanvasMessage } from '../types'

export function WorkspaceDirectoryBreadcrumb({
  rootUri,
  uri,
  name,
  isCurrent,
  onNavigate,
  onShowMessage,
}: {
  rootUri: string
  uri: string
  name: string
  isCurrent: boolean
  onNavigate: (uri: string) => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = React.useState<{ x: number; y: number } | null>(null)
  const close = React.useCallback(() => setMenu(null), [])
  const copy = (relative: boolean) => {
    const options = {
      uri,
      rootUri,
      selectedEntryUri: null,
      closeContextMenu: close,
      t,
      onShowMessage,
    }
    void (relative ? copyExplorerRelativePath(options) : copyExplorerAbsolutePath(options))
  }
  return (
    <>
      <button
        type="button"
        data-directory-breadcrumb="true"
        title={decodeUriPathname(uri)}
        aria-current={isCurrent ? 'location' : undefined}
        onClick={() => onNavigate(uri)}
        onContextMenu={event => {
          event.preventDefault()
          event.stopPropagation()
          event.currentTarget.focus()
          setMenu({ x: event.clientX, y: event.clientY })
        }}
        onKeyDown={event => {
          if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) {
            return
          }
          event.preventDefault()
          event.stopPropagation()
          const bounds = event.currentTarget.getBoundingClientRect()
          setMenu({ x: bounds.left, y: bounds.bottom })
        }}
      >
        {name}
      </button>
      <ViewportMenuSurface
        open={menu !== null}
        placement={{
          type: 'point',
          point: menu ?? { x: 0, y: 0 },
          estimatedSize: { width: 220, height: 88 },
        }}
        className="workspace-context-menu workspace-space-explorer__context-menu"
        data-testid="directory-breadcrumb-context-menu"
        role="menu"
        aria-label={name}
        mobileTitle={name}
        onDismiss={close}
        dismissOnPointerDownOutside
        dismissOnEscape
        onContextMenu={event => {
          event.preventDefault()
          event.stopPropagation()
        }}
      >
        <FilesystemPathMenuItems
          onCopyRelativePath={() => copy(true)}
          onCopyAbsolutePath={() => copy(false)}
        />
      </ViewportMenuSurface>
    </>
  )
}
