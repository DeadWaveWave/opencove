import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Check, ChevronRight, Download, ListTodo, MoreHorizontal, Tag } from 'lucide-react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { LABEL_COLORS, type NodeLabelColorOverride } from '@shared/types/labelColor'
import {
  MENU_WIDTH,
  SUBMENU_CLOSE_DELAY_MS,
  SUBMENU_GAP,
  SUBMENU_MAX_HEIGHT,
  SUBMENU_WIDTH,
  VIEWPORT_PADDING,
  placeSubmenuAtItem,
} from './workspaceCanvas/view/WorkspaceContextMenu.helpers'

interface NoteNodeActionsMenuProps {
  isSavingMarkdown: boolean
  canConvertToTask: boolean
  labelColorOverride: NodeLabelColorOverride
  onSaveMarkdown: () => Promise<void> | void
  onConvertToTask: () => void
  onSetLabelColorOverride: (labelColorOverride: NodeLabelColorOverride) => void
}

const NOTE_MENU_ESTIMATED_HEIGHT = 150

function renderMenuMark(checked: boolean): JSX.Element {
  return checked ? (
    <Check className="workspace-context-menu__mark" aria-hidden="true" />
  ) : (
    <span className="workspace-context-menu__mark" aria-hidden="true" />
  )
}

export function NoteNodeActionsMenu({
  isSavingMarkdown,
  canConvertToTask,
  labelColorOverride,
  onSaveMarkdown,
  onConvertToTask,
  onSetLabelColorOverride,
}: NoteNodeActionsMenuProps): JSX.Element {
  const { t } = useTranslation()
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const submenuRef = useRef<HTMLDivElement | null>(null)
  const labelColorButtonRef = useRef<HTMLButtonElement | null>(null)
  const closeSubmenuTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pointerActivationHandledRef = useRef(false)
  const [menuPoint, setMenuPoint] = useState<{ x: number; y: number } | null>(null)
  const [openSubmenu, setOpenSubmenu] = useState<'label-color' | null>(null)
  const [pinnedSubmenu, setPinnedSubmenu] = useState<'label-color' | null>(null)

  const cancelScheduledSubmenuClose = useCallback(() => {
    if (closeSubmenuTimeoutRef.current === null) {
      return
    }

    clearTimeout(closeSubmenuTimeoutRef.current)
    closeSubmenuTimeoutRef.current = null
  }, [])

  const closeMenu = useCallback(() => {
    cancelScheduledSubmenuClose()
    setMenuPoint(null)
    setOpenSubmenu(null)
    setPinnedSubmenu(null)
  }, [cancelScheduledSubmenuClose])

  const scheduleSubmenuClose = useCallback(() => {
    cancelScheduledSubmenuClose()
    if (pinnedSubmenu !== null) {
      return
    }

    closeSubmenuTimeoutRef.current = setTimeout(() => {
      closeSubmenuTimeoutRef.current = null
      setOpenSubmenu(null)
    }, SUBMENU_CLOSE_DELAY_MS)
  }, [cancelScheduledSubmenuClose, pinnedSubmenu])

  const openLabelColorSubmenu = useCallback(
    (options?: { pinned?: boolean }) => {
      cancelScheduledSubmenuClose()
      setPinnedSubmenu(options?.pinned === true ? 'label-color' : null)
      setOpenSubmenu('label-color')
    },
    [cancelScheduledSubmenuClose],
  )

  const activateFromPointer = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, action: () => void) => {
      if (event.button !== 0 || event.currentTarget.disabled) {
        return
      }

      event.preventDefault()
      event.stopPropagation()
      pointerActivationHandledRef.current = true
      action()

      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          pointerActivationHandledRef.current = false
        }, 0)
      } else {
        pointerActivationHandledRef.current = false
      }
    },
    [],
  )

  const activateFromClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, action: () => void) => {
      event.stopPropagation()
      if (pointerActivationHandledRef.current) {
        pointerActivationHandledRef.current = false
        return
      }

      action()
    },
    [],
  )

  const saveMarkdown = useCallback(() => {
    closeMenu()
    void onSaveMarkdown()
  }, [closeMenu, onSaveMarkdown])

  const convertToTask = useCallback(() => {
    closeMenu()
    onConvertToTask()
  }, [closeMenu, onConvertToTask])

  const setLabelColorOverride = useCallback(
    (override: NodeLabelColorOverride) => {
      onSetLabelColorOverride(override)
      closeMenu()
    },
    [closeMenu, onSetLabelColorOverride],
  )

  const openPinnedLabelColorSubmenu = useCallback(() => {
    openLabelColorSubmenu({ pinned: true })
  }, [openLabelColorSubmenu])

  useEffect(() => {
    return () => {
      cancelScheduledSubmenuClose()
    }
  }, [cancelScheduledSubmenuClose])

  const shouldShowLabelColorSubmenu = menuPoint !== null && openSubmenu === 'label-color'
  const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight
  const submenuMaxHeight = Math.min(SUBMENU_MAX_HEIGHT, viewportHeight - VIEWPORT_PADDING * 2)
  const rootMenuRect = menuRef.current?.getBoundingClientRect() ?? null
  const labelColorButtonRect = labelColorButtonRef.current?.getBoundingClientRect() ?? null
  const submenuPlacement =
    rootMenuRect && labelColorButtonRect
      ? placeSubmenuAtItem({
          parentMenuRect: {
            left: rootMenuRect.left,
            top: rootMenuRect.top,
            width: rootMenuRect.width,
            height: rootMenuRect.height,
          },
          itemRect: {
            left: labelColorButtonRect.left,
            top: labelColorButtonRect.top,
            width: labelColorButtonRect.width,
            height: labelColorButtonRect.height,
          },
          submenuSize: {
            width: SUBMENU_WIDTH,
            height: submenuMaxHeight,
          },
          viewport: { width: viewportWidth, height: viewportHeight },
          gap: SUBMENU_GAP,
        })
      : {
          left: menuPoint?.x ?? VIEWPORT_PADDING,
          top: menuPoint?.y ?? VIEWPORT_PADDING,
        }

  return (
    <>
      <button
        ref={menuButtonRef}
        type="button"
        className="note-node__action nodrag"
        data-testid="note-node-more"
        onPointerDown={event => {
          event.stopPropagation()
        }}
        onClick={event => {
          event.stopPropagation()
          if (menuPoint) {
            closeMenu()
            return
          }

          const rect = event.currentTarget.getBoundingClientRect()
          cancelScheduledSubmenuClose()
          setOpenSubmenu(null)
          setPinnedSubmenu(null)
          setMenuPoint({ x: rect.right, y: rect.bottom + 6 })
        }}
        aria-haspopup="menu"
        aria-expanded={menuPoint !== null}
        aria-label={t('noteNode.moreActions')}
        title={t('noteNode.moreActions')}
      >
        <MoreHorizontal aria-hidden="true" />
      </button>

      {menuPoint ? (
        <ViewportMenuSurface
          open={true}
          ref={menuRef}
          className="workspace-context-menu workspace-canvas-context-menu note-node__menu"
          data-testid="note-node-menu"
          placement={{
            type: 'point',
            point: menuPoint,
            alignX: 'end',
            estimatedSize: { width: MENU_WIDTH, height: NOTE_MENU_ESTIMATED_HEIGHT },
          }}
          onDismiss={closeMenu}
          dismissOnPointerDownOutside={true}
          dismissOnEscape={true}
          dismissIgnoreRefs={[menuButtonRef, submenuRef]}
          onMouseEnter={cancelScheduledSubmenuClose}
          onMouseLeave={scheduleSubmenuClose}
        >
          <button
            type="button"
            data-testid="note-node-menu-save-markdown"
            disabled={isSavingMarkdown}
            onPointerUp={event => {
              activateFromPointer(event, saveMarkdown)
            }}
            onClick={event => {
              activateFromClick(event, saveMarkdown)
            }}
          >
            <Download className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('noteNode.saveMarkdown')}</span>
          </button>

          <button
            type="button"
            data-testid="note-node-menu-convert-to-task"
            disabled={!canConvertToTask}
            onPointerUp={event => {
              activateFromPointer(event, convertToTask)
            }}
            onClick={event => {
              activateFromClick(event, convertToTask)
            }}
          >
            <ListTodo className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">
              {t('workspaceContextMenu.convertToTask')}
            </span>
          </button>

          <button
            ref={labelColorButtonRef}
            type="button"
            data-testid="note-node-menu-label-color"
            aria-haspopup="menu"
            aria-expanded={shouldShowLabelColorSubmenu}
            onMouseEnter={() => {
              openLabelColorSubmenu()
            }}
            onFocus={() => {
              openLabelColorSubmenu()
            }}
            onPointerUp={event => {
              activateFromPointer(event, openPinnedLabelColorSubmenu)
            }}
            onClick={event => {
              activateFromClick(event, openPinnedLabelColorSubmenu)
            }}
          >
            <Tag className="workspace-context-menu__icon" aria-hidden="true" />
            <span className="workspace-context-menu__label">{t('labelColors.title')}</span>
            <ChevronRight
              className={`workspace-context-menu__icon workspace-context-menu__chevron ${
                shouldShowLabelColorSubmenu ? 'workspace-context-menu__chevron--open' : ''
              }`}
              aria-hidden="true"
            />
          </button>
        </ViewportMenuSurface>
      ) : null}

      {shouldShowLabelColorSubmenu ? (
        <ViewportMenuSurface
          open={true}
          ref={submenuRef}
          className="workspace-context-menu workspace-context-menu--submenu workspace-canvas-context-menu workspace-canvas-context-menu--submenu note-node__menu-submenu"
          data-testid="note-node-menu-label-color-menu"
          placement={{
            type: 'absolute',
            top: submenuPlacement.top,
            left: submenuPlacement.left,
          }}
          style={{
            maxHeight: submenuMaxHeight,
          }}
          onMouseEnter={() => {
            cancelScheduledSubmenuClose()
            setPinnedSubmenu(null)
            setOpenSubmenu('label-color')
          }}
          onMouseLeave={scheduleSubmenuClose}
        >
          <button
            type="button"
            data-testid="note-node-menu-label-color-auto-inherit"
            onPointerUp={event => {
              activateFromPointer(event, () => {
                setLabelColorOverride(null)
              })
            }}
            onClick={event => {
              activateFromClick(event, () => {
                setLabelColorOverride(null)
              })
            }}
          >
            <span
              className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--auto"
              aria-hidden="true"
            />
            <span className="workspace-context-menu__label">{t('labelColors.autoInherit')}</span>
            {renderMenuMark(labelColorOverride === null)}
          </button>

          <button
            type="button"
            data-testid="note-node-menu-label-color-none"
            onPointerUp={event => {
              activateFromPointer(event, () => {
                setLabelColorOverride('none')
              })
            }}
            onClick={event => {
              activateFromClick(event, () => {
                setLabelColorOverride('none')
              })
            }}
          >
            <span
              className="workspace-context-menu__icon workspace-label-color-menu__dot workspace-label-color-menu__dot--none"
              aria-hidden="true"
            />
            <span className="workspace-context-menu__label">{t('labelColors.none')}</span>
            {renderMenuMark(labelColorOverride === 'none')}
          </button>

          {LABEL_COLORS.map(color => (
            <button
              key={color}
              type="button"
              data-testid={`note-node-menu-label-color-${color}`}
              onPointerUp={event => {
                activateFromPointer(event, () => {
                  setLabelColorOverride(color)
                })
              }}
              onClick={event => {
                activateFromClick(event, () => {
                  setLabelColorOverride(color)
                })
              }}
            >
              <span
                className="workspace-context-menu__icon workspace-label-color-menu__dot"
                data-cove-label-color={color}
                aria-hidden="true"
              />
              <span className="workspace-context-menu__label">{t(`labelColors.${color}`)}</span>
              {renderMenuMark(labelColorOverride === color)}
            </button>
          ))}
        </ViewportMenuSurface>
      ) : null}
    </>
  )
}
