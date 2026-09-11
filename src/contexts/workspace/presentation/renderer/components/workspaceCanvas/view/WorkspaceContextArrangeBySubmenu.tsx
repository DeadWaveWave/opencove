import React from 'react'
import { Check } from 'lucide-react'
import { ViewportMenuSurface } from '@app/renderer/components/ViewportMenuSurface'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceSpaceState } from '../../../types'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangeSpaceFit,
} from '../../../utils/workspaceArrange'

export type ArrangeScope = 'all' | 'canvas' | 'space'

function renderMark(checked: boolean): React.JSX.Element {
  return checked ? (
    <Check className="workspace-context-menu__mark" aria-hidden="true" />
  ) : (
    <span className="workspace-context-menu__mark" aria-hidden="true" />
  )
}

// Arrange options communicate their current value with the checkmark in the
// leading gutter. Keep the pressed state for assistive technology, while
// opting out of the generic menu selected outline (which is useful for other
// toggle menus but makes this dense settings list look like a set of cards).
const CHECKMARK_ONLY_CLASS = 'workspace-context-menu__checkmark-only'

export function WorkspaceContextArrangeBySubmenu({
  submenuRef,
  style,
  hitSpace,
  canArrangeAll,
  canArrangeCanvas,
  canArrangeHitSpace,
  arrangeScope,
  arrangeOrder,
  arrangeSpaceFit,
  preserveWindowSizes,
  onSelectScope,
  onSelectOrder,
  onSelectSpaceFit,
  onSelectPreserveWindowSizes,
  onBack,
  onDismiss,
}: {
  submenuRef: React.RefObject<HTMLDivElement | null>
  style: React.CSSProperties
  hitSpace: WorkspaceSpaceState | null
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  canArrangeHitSpace: boolean
  arrangeScope: ArrangeScope
  arrangeOrder: WorkspaceArrangeOrder
  arrangeSpaceFit: WorkspaceArrangeSpaceFit
  preserveWindowSizes: boolean
  onSelectScope: (scope: ArrangeScope) => void
  onSelectOrder: (order: WorkspaceArrangeOrder) => void
  onSelectSpaceFit: (fit: WorkspaceArrangeSpaceFit) => void
  onSelectPreserveWindowSizes: (enabled: boolean) => void
  onBack: () => void
  onDismiss: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <ViewportMenuSurface
      open={true}
      mobileTitle={t('workspaceContextMenu.arrangeBy')}
      isSubmenu
      onBack={onBack}
      onDismiss={onDismiss}
      ref={submenuRef}
      className="workspace-context-menu workspace-context-menu--submenu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-arrange-by-menu"
      placement={{
        type: 'absolute',
        top: style.top as number,
        left: style.left as number,
      }}
      style={{
        maxHeight: style.maxHeight,
      }}
    >
      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-scope-all"
        aria-pressed={arrangeScope === 'all'}
        disabled={!canArrangeAll}
        onClick={() => {
          onSelectScope('all')
        }}
      >
        {renderMark(arrangeScope === 'all')}
        <span className="workspace-context-menu__label">{t('workspaceArrangeMenu.scopeAll')}</span>
      </button>
      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-scope-canvas"
        aria-pressed={arrangeScope === 'canvas'}
        disabled={!canArrangeCanvas}
        onClick={() => {
          onSelectScope('canvas')
        }}
      >
        {renderMark(arrangeScope === 'canvas')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.scopeCanvas')}
        </span>
      </button>
      {hitSpace ? (
        <button
          type="button"
          className={CHECKMARK_ONLY_CLASS}
          data-testid="workspace-context-arrange-scope-space"
          aria-pressed={arrangeScope === 'space'}
          disabled={!canArrangeHitSpace}
          onClick={() => {
            onSelectScope('space')
          }}
        >
          {renderMark(arrangeScope === 'space')}
          <span className="workspace-context-menu__label">
            {t('workspaceArrangeMenu.scopeSpace')}
          </span>
        </button>
      ) : null}

      <div className="workspace-context-menu__separator" />

      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-order-position"
        aria-pressed={arrangeOrder === 'position'}
        onClick={() => {
          onSelectOrder('position')
        }}
      >
        {renderMark(arrangeOrder === 'position')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.orderPosition')}
        </span>
      </button>
      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-order-created"
        aria-pressed={arrangeOrder === 'createdAt'}
        onClick={() => {
          onSelectOrder('createdAt')
        }}
      >
        {renderMark(arrangeOrder === 'createdAt')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.orderCreatedAt')}
        </span>
      </button>

      <div className="workspace-context-menu__separator" />
      <div className="workspace-context-menu__section-title">
        {t('workspaceArrangeMenu.windowSize')}
      </div>

      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-preserve-window-sizes"
        aria-pressed={preserveWindowSizes}
        onClick={() => {
          onSelectPreserveWindowSizes(!preserveWindowSizes)
        }}
      >
        {renderMark(preserveWindowSizes)}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.preserveWindowSizes')}
        </span>
      </button>

      <div className="workspace-context-menu__separator" />
      <div className="workspace-context-menu__section-title">
        {t('workspaceArrangeMenu.spaceFit')}
      </div>

      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-space-fit-tight"
        aria-pressed={arrangeSpaceFit === 'tight'}
        onClick={() => {
          onSelectSpaceFit('tight')
        }}
      >
        {renderMark(arrangeSpaceFit === 'tight')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.spaceFitTight')}
        </span>
      </button>
      <button
        type="button"
        className={CHECKMARK_ONLY_CLASS}
        data-testid="workspace-context-arrange-space-fit-keep"
        aria-pressed={arrangeSpaceFit === 'keep'}
        onClick={() => {
          onSelectSpaceFit('keep')
        }}
      >
        {renderMark(arrangeSpaceFit === 'keep')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.spaceFitKeep')}
        </span>
      </button>
    </ViewportMenuSurface>
  )
}
