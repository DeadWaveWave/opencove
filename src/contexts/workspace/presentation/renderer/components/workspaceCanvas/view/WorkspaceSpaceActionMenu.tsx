import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import {
  ChevronRight,
  Copy,
  FolderOpen,
  GitBranchPlus,
  LayoutGrid,
  Package,
  Tag,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspacePathOpener, WorkspacePathOpenerId } from '@shared/contracts/dto'
import { LABEL_COLORS, type LabelColor } from '@shared/types/labelColor'
import type { SpaceActionMenuState } from '../types'
import {
  MENU_WIDTH,
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_GAP,
  SUBMENU_MAX_HEIGHT,
  VIEWPORT_PADDING,
  placeSubmenuAtItem,
} from './WorkspaceContextMenu.helpers'

interface WorkspaceSpaceActionMenuProps {
  menu: SpaceActionMenuState | null
  availableOpeners: WorkspacePathOpener[]
  canArrange?: boolean
  canCreateWorktree: boolean
  canArchive: boolean
  closeMenu: () => void
  setSpaceLabelColor: (spaceId: string, labelColor: LabelColor | null) => void
  onArrange?: (spaceId: string) => void
  onCreateWorktree: () => void
  onArchive: () => void
  onCopyPath: () => void | Promise<void>
  onOpenPath: (openerId: WorkspacePathOpenerId) => void | Promise<void>
}

const SUBMENU_WIDTH = MENU_WIDTH

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
  canArrange = true,
  canCreateWorktree,
  canArchive,
  closeMenu,
  setSpaceLabelColor,
  onArrange,
  onCreateWorktree,
  onArchive,
  onCopyPath,
  onOpenPath,
}: WorkspaceSpaceActionMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [openSubmenu, setOpenSubmenu] = React.useState<'open' | 'label-color' | null>(null)
  const [pinnedSubmenu, setPinnedSubmenu] = React.useState<'open' | 'label-color' | null>(null)
  const closeSubmenuTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const openButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const labelColorButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const submenuRef = React.useRef<HTMLDivElement | null>(null)
  const [measuredSubmenuSize, setMeasuredSubmenuSize] = React.useState<{
    width: number
    height: number
  } | null>(null)
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
    if (pinnedSubmenu !== null) {
      return
    }

    closeSubmenuTimeoutRef.current = setTimeout(() => {
      closeSubmenuTimeoutRef.current = null
      setOpenSubmenu(null)
    }, SUBMENU_CLOSE_DELAY_MS)
  }, [cancelScheduledSubmenuClose, pinnedSubmenu])

  const openSubmenuTransient = React.useCallback(
    (submenu: 'open' | 'label-color') => {
      cancelScheduledSubmenuClose()
      setPinnedSubmenu(null)
      setOpenSubmenu(submenu)
    },
    [cancelScheduledSubmenuClose],
  )

  const openSubmenuPinned = React.useCallback(
    (submenu: 'open' | 'label-color') => {
      cancelScheduledSubmenuClose()
      setPinnedSubmenu(submenu)
      setOpenSubmenu(submenu)
    },
    [cancelScheduledSubmenuClose],
  )

  React.useEffect(() => {
    cancelScheduledSubmenuClose()
    setOpenSubmenu(null)
    setPinnedSubmenu(null)
  }, [cancelScheduledSubmenuClose, menu?.spaceId, menu?.x, menu?.y])

  React.useEffect(() => {
    return () => {
      cancelScheduledSubmenuClose()
    }
  }, [cancelScheduledSubmenuClose])

  React.useLayoutEffect(() => {
    if (!openSubmenu) {
      setMeasuredSubmenuSize(null)
      return
    }

    const submenuElement = submenuRef.current
    if (!submenuElement) {
      setMeasuredSubmenuSize(null)
      return
    }

    const nextRect = submenuElement.getBoundingClientRect()
    setMeasuredSubmenuSize(previous =>
      previous !== null &&
      Math.abs(previous.width - nextRect.width) < 0.5 &&
      Math.abs(previous.height - nextRect.height) < 0.5
        ? previous
        : { width: nextRect.width, height: nextRect.height },
    )
  }, [openSubmenu, menu?.spaceId, menu?.x, menu?.y, sortedOpeners.length])

  if (!menu) {
    return null
  }

  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const menuLeft = Math.min(menu.x, viewportWidth - MENU_WIDTH - VIEWPORT_PADDING)
  const menuTop = Math.min(menu.y, viewportHeight - 120)
  const shouldShowOpenSubmenu = openSubmenu === 'open' && sortedOpeners.length > 0
  const shouldShowLabelColorSubmenu = openSubmenu === 'label-color'
  const rootMenuRect = {
    left: menuLeft,
    top: menuTop,
    width: MENU_WIDTH,
    height: 0,
  }
  const activeSubmenuAnchor =
    openSubmenu === 'open'
      ? openButtonRef.current
      : openSubmenu === 'label-color'
        ? labelColorButtonRef.current
        : null
  const measuredSubmenuAnchorRect = activeSubmenuAnchor?.getBoundingClientRect() ?? null
  const submenuMaxHeight = Math.min(SUBMENU_MAX_HEIGHT, viewportHeight - VIEWPORT_PADDING * 2)
  const submenuVisibleHeight =
    measuredSubmenuSize !== null
      ? Math.min(submenuMaxHeight, measuredSubmenuSize.height)
      : submenuMaxHeight
  const submenuPlacement = placeSubmenuAtItem({
    parentMenuRect: rootMenuRect,
    itemRect: measuredSubmenuAnchorRect
      ? {
          left: measuredSubmenuAnchorRect.left,
          top: measuredSubmenuAnchorRect.top,
          width: measuredSubmenuAnchorRect.width,
          height: measuredSubmenuAnchorRect.height,
        }
      : rootMenuRect,
    submenuSize: {
      width: measuredSubmenuSize?.width ?? SUBMENU_WIDTH,
      height: submenuVisibleHeight,
    },
    viewport: { width: viewportWidth, height: viewportHeight },
    gap: SUBMENU_GAP,
  })
  const submenuStyle = {
    maxHeight: submenuMaxHeight,
    overflow: 'auto',
  } as const

  return (
    <>
      <ViewportMenuSurface
        open={true}
        className="workspace-context-menu workspace-space-action-menu"
        data-testid="workspace-space-action-menu"
        placement={{
          type: 'absolute',
          top: menuTop,
          left: menuLeft,
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
            ref={openButtonRef}
            onMouseEnter={() => openSubmenuTransient('open')}
            onFocus={() => openSubmenuTransient('open')}
            onClick={() => openSubmenuPinned('open')}
          >
            <FolderOpen className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('spaceActions.open')}</span>
            <ChevronRight
              className="workspace-context-menu__icon workspace-space-action-menu__chevron"
              aria-hidden="true"
            />
          </button>
        ) : null}

        <div className="workspace-context-menu__separator" />

        <button
          type="button"
          data-testid="workspace-space-action-label-color"
          ref={labelColorButtonRef}
          onMouseEnter={() => openSubmenuTransient('label-color')}
          onFocus={() => openSubmenuTransient('label-color')}
          onClick={() => openSubmenuPinned('label-color')}
        >
          <Tag className="workspace-context-menu__icon" aria-hidden="true" />
          <span className="workspace-context-menu__label">{t('labelColors.title')}</span>
          <ChevronRight
            className="workspace-context-menu__icon workspace-space-action-menu__chevron"
            aria-hidden="true"
          />
        </button>

        {onArrange ? (
          <button
            type="button"
            data-testid="workspace-space-action-arrange"
            disabled={!canArrange}
            onClick={() => {
              onArrange(menu.spaceId)
              closeMenu()
            }}
          >
            <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('spaceActions.arrangeInSpace')}
            </span>
          </button>
        ) : null}
      </ViewportMenuSurface>

      {shouldShowOpenSubmenu ? (
        <ViewportMenuSurface
          ref={submenuRef}
          open={true}
          className="workspace-context-menu workspace-space-action-menu workspace-space-action-menu--submenu"
          data-testid="workspace-space-action-open-menu"
          placement={{
            type: 'absolute',
            top: submenuPlacement.top,
            left: submenuPlacement.left,
          }}
          style={submenuStyle}
          onMouseEnter={() => {
            cancelScheduledSubmenuClose()
            setPinnedSubmenu(null)
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
        </ViewportMenuSurface>
      ) : null}

      {shouldShowLabelColorSubmenu ? (
        <ViewportMenuSurface
          ref={submenuRef}
          open={true}
          className="workspace-context-menu workspace-space-action-menu workspace-space-action-menu--submenu"
          data-testid="workspace-space-action-label-color-menu"
          placement={{
            type: 'absolute',
            top: submenuPlacement.top,
            left: submenuPlacement.left,
          }}
          style={submenuStyle}
          onMouseEnter={() => {
            cancelScheduledSubmenuClose()
            setPinnedSubmenu(null)
            setOpenSubmenu('label-color')
          }}
          onMouseLeave={scheduleSubmenuClose}
        >
          <button
            type="button"
            data-testid="workspace-space-action-label-color-none"
            onClick={() => {
              setSpaceLabelColor(menu.spaceId, null)
              closeMenu()
            }}
          >
            <span
              className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--none"
              aria-hidden="true"
            />
            <span className="workspace-context-menu__label">{t('labelColors.none')}</span>
          </button>

          {LABEL_COLORS.map(color => (
            <button
              key={color}
              type="button"
              data-testid={`workspace-space-action-label-color-${color}`}
              onClick={() => {
                setSpaceLabelColor(menu.spaceId, color)
                closeMenu()
              }}
            >
              <span
                className="workspace-context-menu__icon workspace-label-color-menu__dot"
                data-cove-label-color={color}
                aria-hidden="true"
              />
              <span className="workspace-context-menu__label">{t(`labelColors.${color}`)}</span>
            </button>
          ))}
        </ViewportMenuSurface>
      ) : null}
    </>
  )
}
