import React from 'react'
import { Check } from 'lucide-react'
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
  onSelectScope,
  onSelectOrder,
  onSelectSpaceFit,
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
  onSelectScope: (scope: ArrangeScope) => void
  onSelectOrder: (order: WorkspaceArrangeOrder) => void
  onSelectSpaceFit: (fit: WorkspaceArrangeSpaceFit) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      ref={submenuRef}
      className="workspace-context-menu workspace-context-menu--submenu workspace-canvas-context-menu workspace-canvas-context-menu--submenu"
      data-testid="workspace-context-arrange-by-menu"
      style={style}
      onMouseDown={event => {
        event.stopPropagation()
      }}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <button
        type="button"
        data-testid="workspace-context-arrange-scope-all"
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
        data-testid="workspace-context-arrange-scope-canvas"
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
          data-testid="workspace-context-arrange-scope-space"
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
        data-testid="workspace-context-arrange-order-position"
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
        data-testid="workspace-context-arrange-order-created"
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
        {t('workspaceArrangeMenu.spaceFit')}
      </div>

      <button
        type="button"
        data-testid="workspace-context-arrange-space-fit-tight"
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
        data-testid="workspace-context-arrange-space-fit-keep"
        onClick={() => {
          onSelectSpaceFit('keep')
        }}
      >
        {renderMark(arrangeSpaceFit === 'keep')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.spaceFitKeep')}
        </span>
      </button>
    </div>
  )
}
