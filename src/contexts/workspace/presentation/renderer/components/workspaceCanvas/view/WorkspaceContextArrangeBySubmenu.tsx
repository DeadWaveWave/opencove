import React from 'react'
import { Check } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceSpaceState } from '../../../types'
import type {
  WorkspaceArrangeOrder,
  WorkspaceArrangePaper,
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
  style,
  hitSpace,
  canArrangeAll,
  canArrangeCanvas,
  canArrangeHitSpace,
  arrangeScope,
  arrangeOrder,
  arrangeSpaceFit,
  arrangePaper,
  isDensePackingEnabled,
  onSelectScope,
  onSelectOrder,
  onSelectSpaceFit,
  onTogglePaperA4,
  onToggleDense,
}: {
  style: React.CSSProperties
  hitSpace: WorkspaceSpaceState | null
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  canArrangeHitSpace: boolean
  arrangeScope: ArrangeScope
  arrangeOrder: WorkspaceArrangeOrder
  arrangeSpaceFit: WorkspaceArrangeSpaceFit
  arrangePaper: WorkspaceArrangePaper
  isDensePackingEnabled: boolean
  onSelectScope: (scope: ArrangeScope) => void
  onSelectOrder: (order: WorkspaceArrangeOrder) => void
  onSelectSpaceFit: (fit: WorkspaceArrangeSpaceFit) => void
  onTogglePaperA4: () => void
  onToggleDense: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      className="workspace-context-menu workspace-context-menu--submenu"
      data-testid="workspace-context-arrange-by-menu"
      style={style}
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <div className="workspace-context-menu__section-title">{t('workspaceArrangeMenu.scope')}</div>
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

      <div className="workspace-context-menu__section-title">{t('workspaceArrangeMenu.order')}</div>
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
      <button
        type="button"
        data-testid="workspace-context-arrange-order-kind"
        onClick={() => {
          onSelectOrder('kind')
        }}
      >
        {renderMark(arrangeOrder === 'kind')}
        <span className="workspace-context-menu__label">{t('workspaceArrangeMenu.orderKind')}</span>
      </button>
      <button
        type="button"
        data-testid="workspace-context-arrange-order-size"
        onClick={() => {
          onSelectOrder('size')
        }}
      >
        {renderMark(arrangeOrder === 'size')}
        <span className="workspace-context-menu__label">{t('workspaceArrangeMenu.orderSize')}</span>
      </button>

      <div className="workspace-context-menu__separator" />

      <div className="workspace-context-menu__section-title">
        {t('workspaceArrangeMenu.layout')}
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
        data-testid="workspace-context-arrange-space-fit-grow"
        onClick={() => {
          onSelectSpaceFit('grow')
        }}
      >
        {renderMark(arrangeSpaceFit === 'grow')}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.spaceFitGrow')}
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

      <div className="workspace-context-menu__separator" />

      <div className="workspace-context-menu__section-title">{t('workspaceArrangeMenu.style')}</div>
      <button
        type="button"
        data-testid="workspace-context-arrange-paper-a4"
        onClick={() => {
          onTogglePaperA4()
        }}
      >
        {renderMark(arrangePaper === 'a4')}
        <span className="workspace-context-menu__label">{t('workspaceArrangeMenu.paperA4')}</span>
      </button>
      <button
        type="button"
        data-testid="workspace-context-arrange-dense"
        onClick={() => {
          onToggleDense()
        }}
      >
        {renderMark(isDensePackingEnabled)}
        <span className="workspace-context-menu__label">{t('workspaceArrangeMenu.dense')}</span>
      </button>
    </div>
  )
}
