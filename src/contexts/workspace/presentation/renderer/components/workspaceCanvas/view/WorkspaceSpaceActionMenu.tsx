import React from 'react'
import { ChevronRight, Copy, FolderOpen, GitBranchPlus, Package } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspacePathOpener, WorkspacePathOpenerId } from '@shared/contracts/dto'
import type { SpaceActionMenuState } from '../types'

interface WorkspaceSpaceActionMenuProps {
  menu: SpaceActionMenuState | null
  availableOpeners: WorkspacePathOpener[]
  canCreateWorktree: boolean
  canArchive: boolean
  closeMenu: () => void
  onCreateWorktree: () => void
  onArchive: () => void
  onCopyPath: () => void | Promise<void>
  onOpenPath: (openerId: WorkspacePathOpenerId) => void | Promise<void>
}

const MENU_WIDTH = 188
const SUBMENU_WIDTH = 188
const VIEWPORT_PADDING = 12
const SUBMENU_CLOSE_DELAY_MS = 120

function getWorkspacePathOpenerSortRank(openerId: WorkspacePathOpenerId): number {
  if (openerId === 'finder') {
    return 0
  }

  if (openerId === 'terminal') {
    return 1
  }

  return 2
}

function sortWorkspacePathOpeners(openers: WorkspacePathOpener[]): WorkspacePathOpener[] {
  return [...openers].sort((left, right) => {
    const rankDifference =
      getWorkspacePathOpenerSortRank(left.id) - getWorkspacePathOpenerSortRank(right.id)

    if (rankDifference !== 0) {
      return rankDifference
    }

    return left.label.localeCompare(right.label, undefined, { sensitivity: 'base' })
  })
}

export function WorkspaceSpaceActionMenu({
  menu,
  availableOpeners,
  canCreateWorktree,
  canArchive,
  closeMenu,
  onCreateWorktree,
  onArchive,
  onCopyPath,
  onOpenPath,
}: WorkspaceSpaceActionMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [openSubmenu, setOpenSubmenu] = React.useState<'open' | null>(null)
  const closeSubmenuTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const sortedOpeners = React.useMemo(
    () => sortWorkspacePathOpeners(availableOpeners),
    [availableOpeners],
  )

  const cancelScheduledSubmenuClose = React.useCallback(() => {
    if (closeSubmenuTimeoutRef.current === null) {
      return
    }

    clearTimeout(closeSubmenuTimeoutRef.current)
    closeSubmenuTimeoutRef.current = null
  }, [])

  const scheduleSubmenuClose = React.useCallback(() => {
    cancelScheduledSubmenuClose()
    closeSubmenuTimeoutRef.current = setTimeout(() => {
      closeSubmenuTimeoutRef.current = null
      setOpenSubmenu(null)
    }, SUBMENU_CLOSE_DELAY_MS)
  }, [cancelScheduledSubmenuClose])

  React.useEffect(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu(null)
  }, [cancelScheduledSubmenuClose, menu?.spaceId, menu?.x, menu?.y])

  React.useEffect(() => {
    return () => {
      cancelScheduledSubmenuClose()
    }
  }, [cancelScheduledSubmenuClose])

  if (!menu) {
    return null
  }

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const menuLeft = Math.min(menu.x, viewportWidth - MENU_WIDTH - VIEWPORT_PADDING)
  const menuTop = Math.min(menu.y, viewportHeight - 120)
  const shouldShowOpenSubmenu = openSubmenu === 'open' && sortedOpeners.length > 0
  const submenuWouldOverflow =
    menuLeft + MENU_WIDTH + SUBMENU_WIDTH > viewportWidth - VIEWPORT_PADDING
  const submenuLeft = submenuWouldOverflow ? menuLeft - SUBMENU_WIDTH : menuLeft + MENU_WIDTH
  const submenuTop = menuTop

  return (
    <>
      <div
        className="workspace-context-menu workspace-space-action-menu"
        data-testid="workspace-space-action-menu"
        style={{ top: menuTop, left: menuLeft }}
        onClick={event => {
          event.stopPropagation()
        }}
        onMouseEnter={cancelScheduledSubmenuClose}
        onMouseLeave={scheduleSubmenuClose}
      >
        {canCreateWorktree ? (
          <button
            type="button"
            data-testid="workspace-space-action-create"
            onClick={() => {
              onCreateWorktree()
              closeMenu()
            }}
          >
            <GitBranchPlus className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('spaceActions.createWorktree')}
            </span>
          </button>
        ) : null}

        {canArchive ? (
          <button
            type="button"
            data-testid="workspace-space-action-archive"
            onClick={() => {
              onArchive()
              closeMenu()
            }}
          >
            <Package className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('spaceActions.archive')}</span>
          </button>
        ) : null}

        <button
          type="button"
          data-testid="workspace-space-action-copy-path"
          onClick={() => {
            void Promise.resolve(onCopyPath()).finally(closeMenu)
          }}
        >
          <Copy className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{t('spaceActions.copyPath')}</span>
        </button>

        {sortedOpeners.length > 0 ? (
          <button
            type="button"
            data-testid="workspace-space-action-open"
            onMouseEnter={() => {
              cancelScheduledSubmenuClose()
              setOpenSubmenu('open')
            }}
            onFocus={() => {
              cancelScheduledSubmenuClose()
              setOpenSubmenu('open')
            }}
            onClick={() => {
              cancelScheduledSubmenuClose()
              setOpenSubmenu(previous => (previous === 'open' ? null : 'open'))
            }}
          >
            <FolderOpen className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('spaceActions.open')}</span>
            <ChevronRight
              className="workspace-context-menu__icon workspace-space-action-menu__chevron"
              aria-hidden="true"
            />
          </button>
        ) : null}
      </div>

      {shouldShowOpenSubmenu ? (
        <div
          className="workspace-context-menu workspace-space-action-menu workspace-space-action-menu--submenu"
          data-testid="workspace-space-action-open-menu"
          style={{ top: submenuTop, left: submenuLeft }}
          onClick={event => {
            event.stopPropagation()
          }}
          onMouseEnter={() => {
            cancelScheduledSubmenuClose()
            setOpenSubmenu('open')
          }}
          onMouseLeave={scheduleSubmenuClose}
        >
          {sortedOpeners.map(opener => (
            <button
              key={opener.id}
              type="button"
              data-testid={`workspace-space-action-open-${opener.id}`}
              onClick={() => {
                void Promise.resolve(onOpenPath(opener.id)).finally(closeMenu)
              }}
            >
              <FolderOpen className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">{opener.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </>
  )
}
