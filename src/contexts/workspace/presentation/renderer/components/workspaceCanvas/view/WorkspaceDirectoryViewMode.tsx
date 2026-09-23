import React from 'react'
import { LayoutGrid, ListTree } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceDirectoryViewMode({
  viewMode,
  onViewModeChange,
  disabled = false,
}: {
  viewMode: 'icons' | 'list'
  onViewModeChange?: (mode: 'icons' | 'list') => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div
      className="cove-directory-view-mode nodrag"
      role="group"
      aria-label={t('spaceExplorer.viewMode')}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      {(
        [
          ['icons', LayoutGrid],
          ['list', ListTree],
        ] as const
      ).map(([mode, Icon]) => (
        <button
          key={mode}
          type="button"
          className="cove-directory-view-mode__button"
          aria-label={t(mode === 'icons' ? 'spaceExplorer.iconsView' : 'spaceExplorer.listView')}
          title={t(mode === 'icons' ? 'spaceExplorer.iconsView' : 'spaceExplorer.listView')}
          aria-pressed={mode === viewMode}
          disabled={disabled || !onViewModeChange}
          onClick={() => onViewModeChange?.(mode)}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}
    </div>
  )
}
