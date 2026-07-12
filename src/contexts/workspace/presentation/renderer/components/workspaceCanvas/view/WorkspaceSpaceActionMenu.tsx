import React from 'react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import {
  Check,
  ChevronRight,
  Copy,
  FolderOpen,
  GitBranchPlus,
  LayoutGrid,
  Package,
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
  currentLabelColor?: LabelColor | null
  preserveWindowSizes?: boolean
  closeMenu: () => void
  setSpaceLabelColor: (spaceId: string, labelColor: LabelColor | null) => void
  onChangePreserveWindowSizes?: (enabled: boolean) => void
  onArrange?: (spaceId: string) => void
  onCreateWorktree: (anchor: { x: number; y: number }) => void
  onArchive: (anchor: { x: number; y: number }) => void
  onCopyPath: () => void | Promise<void>
  onOpenPath: (openerId: WorkspacePathOpenerId) => void | Promise<void>
}

const SUBMENU_WIDTH = MENU_WIDTH
const SPACE_ACTION_MENU_WIDTH = 220

function renderMark(checked: boolean): React.JSX.Element {
  return checked ? (
    <Check className="workspace-context-menu__mark" aria-hidden="true" />
  ) : (
    <span className="workspace-context-menu__mark" aria-hidden="true" />
  )
}

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
  currentLabelColor = null,
  preserveWindowSizes = false,
  closeMenu,
  setSpaceLabelColor,
  onChangePreserveWindowSizes,
  onArrange,
  onCreateWorktree,
  onArchive,
  onCopyPath,
  onOpenPath,
}: WorkspaceSpaceActionMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [openSubmenu, setOpenSubmenu] = React.useState<'open' | null>(null)
  const [pinnedSubmenu, setPinnedSubmenu] = React.useState<'open' | null>(null)
  const closeSubmenuTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const openButtonRef = React.useRef<HTMLButtonElement | null>(null)
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
    (submenu: 'open') => {
      cancelScheduledSubmenuClose()
      setPinnedSubmenu(null)
      setOpenSubmenu(submenu)
    },
    [cancelScheduledSubmenuClose],
  )

  const openSubmenuPinned = React.useCallback(
    (submenu: 'open') => {
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
  const menuLeft = Math.min(menu.x, viewportWidth - SPACE_ACTION_MENU_WIDTH - VIEWPORT_PADDING)
  const menuTop = Math.min(menu.y, viewportHeight - 120)
  const shouldShowOpenSubmenu = openSubmenu === 'open' && sortedOpeners.length > 0
  const rootMenuRect = {
    left: menuLeft,
    top: menuTop,
    width: SPACE_ACTION_MENU_WIDTH,
    height: 0,
  }
  const activeSubmenuAnchor = openSubmenu === 'open' ? openButtonRef.current : null
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
        <div
          className="workspace-space-action-menu__color-strip"
          data-testid="workspace-space-action-label-color-menu"
        >
          <button
            type="button"
            className={`workspace-space-action-menu__color-button${currentLabelColor === null ? ' workspace-space-action-menu__color-button--selected' : ''}`}
            data-testid="workspace-space-action-label-color-none"
            aria-label={t('labelColors.none')}
            title={t('labelColors.none')}
            onClick={() => {
              setSpaceLabelColor(menu.spaceId, null)
              closeMenu()
            }}
          >
            <span
              className="workspace-label-color-menu__dot workspace-label-color-menu__dot--none"
              aria-hidden="true"
            />
            {currentLabelColor === null ? (
              <Check className="workspace-space-action-menu__color-check" aria-hidden="true" />
            ) : null}
          </button>

          {LABEL_COLORS.map(color => {
            const selected = currentLabelColor === color

            return (
              <button
                key={color}
                type="button"
                className={`workspace-space-action-menu__color-button${selected ? ' workspace-space-action-menu__color-button--selected' : ''}`}
                data-testid={`workspace-space-action-label-color-${color}`}
                aria-label={t(`labelColors.${color}`)}
                title={t(`labelColors.${color}`)}
                onClick={() => {
                  setSpaceLabelColor(menu.spaceId, color)
                  closeMenu()
                }}
              >
                <span
                  className="workspace-label-color-menu__dot"
                  data-cove-label-color={color}
                  aria-hidden="true"
                />
                {selected ? (
                  <Check className="workspace-space-action-menu__color-check" aria-hidden="true" />
                ) : null}
              </button>
            )
          })}
        </div>

        <div className="workspace-context-menu__separator" />

        {canCreateWorktree ? (
          <button
            type="button"
            data-testid="workspace-space-action-create"
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              onCreateWorktree({ x: Math.round(rect.left), y: Math.round(rect.top) })
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
            onClick={event => {
              const rect = event.currentTarget.getBoundingClientRect()
              onArchive({ x: Math.round(rect.left), y: Math.round(rect.top) })
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

        {onChangePreserveWindowSizes ? (
          <button
            type="button"
            data-testid="workspace-space-action-preserve-window-sizes"
            onClick={() => {
              onChangePreserveWindowSizes(!preserveWindowSizes)
            }}
          >
            {renderMark(preserveWindowSizes)}
            <span className="workspace-context-menu__label">
              {t('workspaceArrangeMenu.preserveWindowSizes')}
            </span>
          </button>
        ) : null}

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
    </>
  )
}
