import React from 'react'
import { ChevronDown, Tag, X } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { LABEL_COLORS, type LabelColor } from '@shared/types/labelColor'
import type { WorkspaceSpaceState } from '../../../types'
import { WorkspaceSpaceSwitcher } from './WorkspaceSpaceSwitcher'

interface WorkspaceCanvasTopOverlaysProps {
  spaces: WorkspaceSpaceState[]
  activateSpace: (spaceId: string) => void
  activateAllSpaces: () => void
  cancelSpaceRename: () => void
  usedLabelColors: LabelColor[]
  activeLabelColorFilter: LabelColor | null
  onToggleLabelColorFilter: (color: LabelColor) => void
  selectedNodeCount: number
}

export function WorkspaceCanvasTopOverlays({
  spaces,
  activateSpace,
  activateAllSpaces,
  cancelSpaceRename,
  usedLabelColors,
  activeLabelColorFilter,
  onToggleLabelColorFilter,
  selectedNodeCount,
}: WorkspaceCanvasTopOverlaysProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [isFilterMenuOpen, setIsFilterMenuOpen] = React.useState(false)
  const filterTriggerRef = React.useRef<HTMLButtonElement | null>(null)
  const filterMenuRef = React.useRef<HTMLDivElement | null>(null)

  const orderedUsedLabelColors = React.useMemo(() => {
    const usedSet = new Set(usedLabelColors)
    const ordered = LABEL_COLORS.filter(color => usedSet.has(color))

    if (activeLabelColorFilter && !usedSet.has(activeLabelColorFilter)) {
      ordered.unshift(activeLabelColorFilter)
    }

    return ordered
  }, [usedLabelColors, activeLabelColorFilter])

  const filterMenuStyle = React.useMemo((): React.CSSProperties | undefined => {
    if (!isFilterMenuOpen) {
      return undefined
    }

    const rect = filterTriggerRef.current?.getBoundingClientRect() ?? null
    const viewportWidth = typeof window === 'undefined' ? 1280 : window.innerWidth
    const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight

    const menuWidth = 196
    const menuHeight = 280
    const viewportPadding = 12
    const offset = 6

    const anchorLeft = rect?.left ?? viewportPadding
    const anchorTop = rect?.bottom ?? viewportPadding

    const left = Math.min(anchorLeft, viewportWidth - menuWidth - viewportPadding)
    const top = Math.min(anchorTop + offset, viewportHeight - menuHeight - viewportPadding)

    return { top, left }
  }, [isFilterMenuOpen])

  const hasAnyOverlay =
    selectedNodeCount > 0 || spaces.length > 0 || orderedUsedLabelColors.length > 0

  React.useEffect(() => {
    if (!isFilterMenuOpen) {
      return
    }

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        setIsFilterMenuOpen(false)
        return
      }

      if (filterTriggerRef.current?.contains(target) || filterMenuRef.current?.contains(target)) {
        return
      }

      setIsFilterMenuOpen(false)
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFilterMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', onPointerDown, { capture: true })
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, { capture: true })
      window.removeEventListener('keydown', onKeyDown, { capture: true })
    }
  }, [isFilterMenuOpen])

  if (!hasAnyOverlay) {
    return null
  }

  return (
    <div className="workspace-canvas__top-overlays">
      {spaces.length > 0 ? (
        <WorkspaceSpaceSwitcher
          spaces={spaces}
          activateSpace={activateSpace}
          activateAllSpaces={activateAllSpaces}
          cancelSpaceRename={cancelSpaceRename}
        />
      ) : null}

      {orderedUsedLabelColors.length > 0 ? (
        <>
          <div
            className="workspace-label-color-filter"
            onMouseDown={event => {
              event.stopPropagation()
            }}
            onClick={event => {
              event.stopPropagation()
            }}
          >
            <button
              ref={filterTriggerRef}
              type="button"
              className={`workspace-label-color-filter__trigger${isFilterMenuOpen ? ' workspace-label-color-filter__trigger--open' : ''}`}
              data-testid="workspace-label-color-filter"
              aria-haspopup="menu"
              aria-expanded={isFilterMenuOpen}
              onClick={() => {
                setIsFilterMenuOpen(previous => !previous)
              }}
            >
              {activeLabelColorFilter ? (
                <span
                  className="cove-label-dot cove-label-dot--solid"
                  data-cove-label-color={activeLabelColorFilter}
                  aria-hidden="true"
                />
              ) : (
                <Tag className="workspace-label-color-filter__icon" aria-hidden="true" />
              )}
              <span className="workspace-label-color-filter__label">
                {activeLabelColorFilter
                  ? t(`labelColors.${activeLabelColorFilter}`)
                  : t('labelColors.title')}
              </span>
              <ChevronDown
                className={`workspace-label-color-filter__chevron${isFilterMenuOpen ? ' workspace-label-color-filter__chevron--open' : ''}`}
                aria-hidden="true"
              />
            </button>

            {activeLabelColorFilter ? (
              <button
                type="button"
                className="workspace-label-color-filter__clear"
                data-testid="workspace-label-color-filter-clear"
                aria-label={t('workspaceCanvas.clearLabelColorFilter')}
                title={t('workspaceCanvas.clearLabelColorFilter')}
                onClick={event => {
                  event.stopPropagation()
                  onToggleLabelColorFilter(activeLabelColorFilter)
                  setIsFilterMenuOpen(false)
                }}
              >
                <X className="workspace-label-color-filter__clear-icon" aria-hidden="true" />
              </button>
            ) : null}
          </div>

          {isFilterMenuOpen ? (
            <div
              ref={filterMenuRef}
              className="workspace-context-menu workspace-label-color-filter__menu"
              data-testid="workspace-label-color-filter-menu"
              style={filterMenuStyle}
              role="menu"
              onClick={event => {
                event.stopPropagation()
              }}
            >
              <button
                type="button"
                role="menuitemradio"
                aria-checked={activeLabelColorFilter === null}
                data-testid="workspace-label-color-filter-all"
                onClick={() => {
                  if (activeLabelColorFilter) {
                    onToggleLabelColorFilter(activeLabelColorFilter)
                  }
                  setIsFilterMenuOpen(false)
                }}
              >
                <span
                  className="workspace-label-color-menu__dot workspace-label-color-menu__dot--none"
                  aria-hidden="true"
                />
                <span className="workspace-context-menu__label">
                  {t('workspaceCanvas.labelColorFilterAll')}
                </span>
              </button>

              {orderedUsedLabelColors.map(color => (
                <button
                  key={color}
                  type="button"
                  role="menuitemradio"
                  aria-checked={activeLabelColorFilter === color}
                  data-testid={`workspace-label-color-filter-${color}`}
                  onClick={() => {
                    onToggleLabelColorFilter(color)
                    setIsFilterMenuOpen(false)
                  }}
                >
                  <span
                    className="workspace-label-color-menu__dot"
                    data-cove-label-color={color}
                    aria-hidden="true"
                  />
                  <span className="workspace-context-menu__label">{t(`labelColors.${color}`)}</span>
                </button>
              ))}
            </div>
          ) : null}
        </>
      ) : null}

      {selectedNodeCount > 0 ? (
        <div className="workspace-selection-hint">
          {t('workspaceCanvas.selectionHint', { count: selectedNodeCount })}
        </div>
      ) : null}
    </div>
  )
}
