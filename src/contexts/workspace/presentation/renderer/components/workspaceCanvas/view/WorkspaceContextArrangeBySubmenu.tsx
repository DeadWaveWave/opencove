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
  style,
  hitSpace,
  canArrangeAll,
  canArrangeCanvas,
  canArrangeHitSpace,
  arrangeScope,
  arrangeOrder,
  arrangeSpaceFit,
  alignCanonicalSizes,
  magneticSnappingEnabled,
  onSelectScope,
  onSelectOrder,
  onSelectSpaceFit,
  onToggleAlignCanonicalSizes,
  onToggleMagneticSnapping,
}: {
  style: React.CSSProperties
  hitSpace: WorkspaceSpaceState | null
  canArrangeAll: boolean
  canArrangeCanvas: boolean
  canArrangeHitSpace: boolean
  arrangeScope: ArrangeScope
  arrangeOrder: WorkspaceArrangeOrder
  arrangeSpaceFit: WorkspaceArrangeSpaceFit
  alignCanonicalSizes: boolean
  magneticSnappingEnabled: boolean
  onSelectScope: (scope: ArrangeScope) => void
  onSelectOrder: (order: WorkspaceArrangeOrder) => void
  onSelectSpaceFit: (fit: WorkspaceArrangeSpaceFit) => void
  onToggleAlignCanonicalSizes: () => void
  onToggleMagneticSnapping: () => void
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

      <button
        type="button"
        data-testid="workspace-context-arrange-canonical-sizes"
        onClick={() => {
          onToggleAlignCanonicalSizes()
        }}
      >
        {renderMark(alignCanonicalSizes)}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.alignCanonicalSizes')}
        </span>
      </button>

      <button
        type="button"
        data-testid="workspace-context-arrange-magnetic-snapping"
        onClick={() => {
          onToggleMagneticSnapping()
        }}
      >
        {renderMark(magneticSnappingEnabled)}
        <span className="workspace-context-menu__label">
          {t('workspaceArrangeMenu.magneticSnapping')}
        </span>
      </button>
    </div>
  )
}
