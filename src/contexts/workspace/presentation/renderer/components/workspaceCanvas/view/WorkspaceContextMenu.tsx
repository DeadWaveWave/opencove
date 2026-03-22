import React from 'react'
import {
  ArrowRight,
  ChevronRight,
  FileText,
  Group,
  LayoutGrid,
  ListTodo,
  Play,
  SlidersHorizontal,
  Terminal,
  X,
} from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceSpaceState } from '../../../types'
import type { ContextMenuState } from '../types'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangeSpaceFit,
  WorkspaceArrangeStyle,
} from '../../../utils/workspaceArrange'
import {
  WorkspaceContextArrangeBySubmenu,
  type ArrangeScope,
} from './WorkspaceContextArrangeBySubmenu'

interface WorkspaceContextMenuProps {
  contextMenu: ContextMenuState | null
  closeContextMenu: () => void
  createTerminalNode: () => Promise<void>
  createNoteNodeFromContextMenu: () => void
  openTaskCreator: () => void
  openAgentLauncher: () => void
  spaces: WorkspaceSpaceState[]
  magneticSnappingEnabled: boolean
  onToggleMagneticSnapping: () => void
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  arrangeAll: (style?: WorkspaceArrangeStyle) => void
  arrangeCanvas: (style?: WorkspaceArrangeStyle) => void
  arrangeInSpace: (spaceId: string, style?: WorkspaceArrangeStyle) => void
  createSpaceFromSelectedNodes: () => void
  clearNodeSelection: () => void
  canConvertSelectedNoteToTask: boolean
  isConvertSelectedNoteToTaskDisabled: boolean
  convertSelectedNoteToTask: () => void
}

const VIEWPORT_PADDING_PX = 12
const SUBMENU_GAP_PX = 6
const SUBMENU_WIDTH_PX = 240
const SUBMENU_MAX_HEIGHT_PX = 640
const MENU_WIDTH_ESTIMATE_PX = 200

function isPointWithinRect(
  point: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    point.x >= rect.x &&
    point.y >= rect.y &&
    point.x <= rect.x + rect.width &&
    point.y <= rect.y + rect.height
  )
}

export function WorkspaceContextMenu({
  contextMenu,
  closeContextMenu,
  createTerminalNode,
  createNoteNodeFromContextMenu,
  openTaskCreator,
  openAgentLauncher,
  spaces,
  magneticSnappingEnabled,
  onToggleMagneticSnapping,
  canArrangeAll,
  canArrangeCanvas,
  arrangeAll,
  arrangeCanvas,
  arrangeInSpace,
  createSpaceFromSelectedNodes,
  clearNodeSelection,
  canConvertSelectedNoteToTask,
  isConvertSelectedNoteToTaskDisabled,
  convertSelectedNoteToTask,
}: WorkspaceContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation()

  const [contextHitSpaceId, setContextHitSpaceId] = React.useState<string | null>(null)
  const contextHitSpaceIdRef = React.useRef<string | null>(null)
  const contextMenuSignatureRef = React.useRef<string | null>(null)

  const [arrangeScope, setArrangeScope] = React.useState<ArrangeScope>('canvas')
  const arrangeScopeRef = React.useRef<ArrangeScope>('canvas')
  const [arrangeOrder, setArrangeOrder] = React.useState<WorkspaceArrangeOrder>('position')
  const arrangeOrderRef = React.useRef<WorkspaceArrangeOrder>('position')
  const [arrangeSpaceFit, setArrangeSpaceFit] = React.useState<WorkspaceArrangeSpaceFit>('tight')
  const arrangeSpaceFitRef = React.useRef<WorkspaceArrangeSpaceFit>('tight')
  const [alignCanonicalSizes, setAlignCanonicalSizes] = React.useState(true)
  const alignCanonicalSizesRef = React.useRef(true)

  const [openSubmenu, setOpenSubmenu] = React.useState<'arrangeBy' | null>(null)
  const menuRef = React.useRef<HTMLDivElement | null>(null)
  const arrangeByButtonRef = React.useRef<HTMLButtonElement | null>(null)
  const [submenuLayout, setSubmenuLayout] = React.useState<{
    left: number
    top: number
    maxHeight: number
  } | null>(null)

  React.useEffect(() => {
    const signature = contextMenu
      ? `${contextMenu.kind}:${contextMenu.x}:${contextMenu.y}:${'flowX' in contextMenu ? contextMenu.flowX : 0}:${
          'flowY' in contextMenu ? contextMenu.flowY : 0
        }`
      : 'null'

    if (signature === contextMenuSignatureRef.current) {
      return
    }

    contextMenuSignatureRef.current = signature
    setOpenSubmenu(null)

    if (!contextMenu || contextMenu.kind !== 'pane') {
      contextHitSpaceIdRef.current = null
      setContextHitSpaceId(null)
      arrangeScopeRef.current = 'canvas'
      setArrangeScope('canvas')
      return
    }

    const anchor = { x: contextMenu.flowX, y: contextMenu.flowY }
    const hitSpace =
      spaces.find(space => space.rect && isPointWithinRect(anchor, space.rect)) ?? null
    const nextHitSpaceId = hitSpace?.id ?? null

    contextHitSpaceIdRef.current = nextHitSpaceId
    setContextHitSpaceId(nextHitSpaceId)

    const nextScope: ArrangeScope = nextHitSpaceId ? 'space' : 'canvas'
    arrangeScopeRef.current = nextScope
    setArrangeScope(nextScope)
  }, [contextMenu, spaces])

  const contextHitSpace = React.useMemo(() => {
    if (!contextHitSpaceId) {
      return null
    }

    return spaces.find(space => space.id === contextHitSpaceId) ?? null
  }, [contextHitSpaceId, spaces])

  const resolveCurrentArrangeStyle = React.useCallback((): WorkspaceArrangeStyle => {
    return {
      order: arrangeOrderRef.current,
      spaceFit: arrangeSpaceFitRef.current,
      alignCanonicalSizes: alignCanonicalSizesRef.current,
    }
  }, [])

  const applyArrange = React.useCallback(
    (options?: { scope?: ArrangeScope; style?: WorkspaceArrangeStyle }) => {
      const scope = options?.scope ?? arrangeScopeRef.current
      const style = options?.style ?? resolveCurrentArrangeStyle()

      if (scope === 'all') {
        arrangeAll(style)
        return
      }

      if (scope === 'canvas') {
        arrangeCanvas(style)
        return
      }

      const spaceId = contextHitSpaceIdRef.current
      if (spaceId) {
        arrangeInSpace(spaceId, style)
      }
    },
    [arrangeAll, arrangeCanvas, arrangeInSpace, resolveCurrentArrangeStyle],
  )

  const commitArrangeAndClose = React.useCallback(
    (options?: { scope?: ArrangeScope; style?: WorkspaceArrangeStyle }) => {
      closeContextMenu()
      setOpenSubmenu(null)
      applyArrange(options)
    },
    [applyArrange, closeContextMenu],
  )

  React.useLayoutEffect(() => {
    if (!contextMenu || contextMenu.kind !== 'pane' || openSubmenu !== 'arrangeBy') {
      setSubmenuLayout(null)
      return
    }

    const menuElement = menuRef.current
    const anchorButton = arrangeByButtonRef.current
    if (!menuElement || !anchorButton) {
      setSubmenuLayout(null)
      return
    }

    const menuRect = menuElement.getBoundingClientRect()
    const anchorRect = anchorButton.getBoundingClientRect()

    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
    const maxHeight = Math.min(SUBMENU_MAX_HEIGHT_PX, viewportHeight - VIEWPORT_PADDING_PX * 2)

    const wouldOverflowRight =
      menuRect.right + SUBMENU_GAP_PX + SUBMENU_WIDTH_PX > viewportWidth - VIEWPORT_PADDING_PX
    const left = wouldOverflowRight
      ? Math.max(VIEWPORT_PADDING_PX, menuRect.left - SUBMENU_GAP_PX - SUBMENU_WIDTH_PX)
      : Math.min(
          viewportWidth - VIEWPORT_PADDING_PX - SUBMENU_WIDTH_PX,
          menuRect.right + SUBMENU_GAP_PX,
        )

    const top = Math.max(
      VIEWPORT_PADDING_PX,
      Math.min(anchorRect.top, viewportHeight - VIEWPORT_PADDING_PX - maxHeight),
    )

    setSubmenuLayout({ left, top, maxHeight })
  }, [contextMenu, openSubmenu])

  if (!contextMenu) {
    return null
  }

  const viewportWidth = typeof window !== 'undefined' ? window.innerWidth : contextMenu.x
  const viewportHeight = typeof window !== 'undefined' ? window.innerHeight : contextMenu.y
  const anchorX = Math.min(
    Math.max(contextMenu.x, VIEWPORT_PADDING_PX),
    Math.max(VIEWPORT_PADDING_PX, viewportWidth - VIEWPORT_PADDING_PX),
  )
  const anchorY = Math.min(
    Math.max(contextMenu.y, VIEWPORT_PADDING_PX),
    Math.max(VIEWPORT_PADDING_PX, viewportHeight - VIEWPORT_PADDING_PX),
  )
  const flipX = contextMenu.x > viewportWidth / 2
  const flipY = contextMenu.y > viewportHeight / 2
  const transform =
    flipX || flipY ? `translate(${flipX ? '-100%' : '0'}, ${flipY ? '-100%' : '0'})` : undefined

  const canArrangeHitSpace = Boolean(contextHitSpace && contextHitSpace.nodeIds.length >= 2)
  const canArrangeCurrentScope =
    arrangeScope === 'all'
      ? canArrangeAll
      : arrangeScope === 'canvas'
        ? canArrangeCanvas
        : canArrangeHitSpace

  const shouldShowArrangeSubmenu = openSubmenu === 'arrangeBy' && contextMenu.kind === 'pane'
  const resolvedSubmenuMaxHeight = Math.min(
    SUBMENU_MAX_HEIGHT_PX,
    viewportHeight - VIEWPORT_PADDING_PX * 2,
  )
  const fallbackSubmenuTop = Math.max(
    VIEWPORT_PADDING_PX,
    Math.min(anchorY, viewportHeight - VIEWPORT_PADDING_PX - resolvedSubmenuMaxHeight),
  )
  const fallbackSubmenuLeft = flipX
    ? Math.max(
        VIEWPORT_PADDING_PX,
        anchorX - MENU_WIDTH_ESTIMATE_PX - SUBMENU_GAP_PX - SUBMENU_WIDTH_PX,
      )
    : Math.min(
        viewportWidth - VIEWPORT_PADDING_PX - SUBMENU_WIDTH_PX,
        anchorX + MENU_WIDTH_ESTIMATE_PX + SUBMENU_GAP_PX,
      )
  const resolvedSubmenuTop = submenuLayout?.top ?? fallbackSubmenuTop
  const resolvedSubmenuLeft = submenuLayout?.left ?? fallbackSubmenuLeft

  return (
    <>
      <div
        ref={menuRef}
        className="workspace-context-menu"
        style={{ top: anchorY, left: anchorX, transform }}
        onClick={event => {
          event.stopPropagation()
        }}
      >
        {contextMenu.kind === 'pane' ? (
          <>
            <button
              type="button"
              data-testid="workspace-context-new-terminal"
              onClick={() => {
                void createTerminalNode()
              }}
            >
              <Terminal className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.newTerminal')}
              </span>
            </button>
            <button
              type="button"
              data-testid="workspace-context-new-note"
              onClick={() => {
                createNoteNodeFromContextMenu()
              }}
            >
              <FileText className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.newNote')}
              </span>
            </button>
            <button
              type="button"
              data-testid="workspace-context-new-task"
              onClick={() => {
                openTaskCreator()
              }}
            >
              <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.newTask')}
              </span>
            </button>
            <button
              type="button"
              data-testid="workspace-context-run-default-agent"
              onClick={() => {
                openAgentLauncher()
              }}
            >
              <Play className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.runAgent')}
              </span>
            </button>

            <div className="workspace-context-menu__separator" />

            <button
              type="button"
              data-testid="workspace-context-arrange"
              disabled={!canArrangeCurrentScope}
              onClick={() => {
                commitArrangeAndClose()
              }}
            >
              <LayoutGrid className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.arrange')}
              </span>
            </button>

            <button
              ref={arrangeByButtonRef}
              type="button"
              data-testid="workspace-context-arrange-by"
              aria-haspopup="menu"
              aria-expanded={openSubmenu === 'arrangeBy'}
              onMouseEnter={() => {
                setOpenSubmenu('arrangeBy')
              }}
              onFocus={() => {
                setOpenSubmenu('arrangeBy')
              }}
              onClick={() => {
                setOpenSubmenu('arrangeBy')
              }}
            >
              <SlidersHorizontal className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.arrangeBy')}
              </span>
              <ChevronRight
                className="workspace-context-menu__icon workspace-context-menu__chevron"
                aria-hidden="true"
              />
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              data-testid="workspace-selection-create-space"
              onClick={() => {
                createSpaceFromSelectedNodes()
              }}
            >
              <Group className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.createSpaceWithSelected')}
              </span>
            </button>
            {canConvertSelectedNoteToTask ? (
              <button
                type="button"
                data-testid="workspace-selection-convert-note-to-task"
                disabled={isConvertSelectedNoteToTaskDisabled}
                onClick={() => {
                  convertSelectedNoteToTask()
                }}
              >
                <ArrowRight className="workspace-context-menu__icon" aria-hidden="true" />
                <span className="workspace-context-menu__label">
                  {t('workspaceContextMenu.convertToTask')}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              data-testid="workspace-selection-clear"
              onClick={() => {
                clearNodeSelection()
                closeContextMenu()
              }}
            >
              <X className="workspace-context-menu__icon" aria-hidden="true" />
              <span className="workspace-context-menu__label">
                {t('workspaceContextMenu.clearSelection')}
              </span>
            </button>
          </>
        )}
      </div>

      {shouldShowArrangeSubmenu ? (
        <WorkspaceContextArrangeBySubmenu
          style={{
            top: resolvedSubmenuTop,
            left: resolvedSubmenuLeft,
            maxHeight: submenuLayout?.maxHeight ?? resolvedSubmenuMaxHeight,
          }}
          hitSpace={contextHitSpace}
          canArrangeAll={canArrangeAll}
          canArrangeCanvas={canArrangeCanvas}
          canArrangeHitSpace={canArrangeHitSpace}
          arrangeScope={arrangeScope}
          arrangeOrder={arrangeOrder}
          arrangeSpaceFit={arrangeSpaceFit}
          alignCanonicalSizes={alignCanonicalSizes}
          magneticSnappingEnabled={magneticSnappingEnabled}
          onSelectScope={scope => {
            arrangeScopeRef.current = scope
            setArrangeScope(scope)
            applyArrange({ scope })
          }}
          onSelectOrder={order => {
            arrangeOrderRef.current = order
            setArrangeOrder(order)
            applyArrange()
          }}
          onSelectSpaceFit={spaceFit => {
            arrangeSpaceFitRef.current = spaceFit
            setArrangeSpaceFit(spaceFit)
            applyArrange()
          }}
          onToggleAlignCanonicalSizes={() => {
            const nextValue = !alignCanonicalSizesRef.current
            alignCanonicalSizesRef.current = nextValue
            setAlignCanonicalSizes(nextValue)
            applyArrange()
          }}
          onToggleMagneticSnapping={onToggleMagneticSnapping}
        />
      ) : null}
    </>
  )
}
