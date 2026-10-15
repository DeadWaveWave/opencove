import React from 'react'
import { LayoutGrid, ListTree } from 'lucide-react'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
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
      onPointerDown={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
    >
      <SegmentedControl
        label={t('spaceExplorer.viewMode')}
        value={viewMode}
        disabled={disabled || !onViewModeChange}
        options={[
          {
            value: 'icons',
            label: t('spaceExplorer.iconsView'),
            icon: <LayoutGrid />,
            iconOnly: true,
          },
          {
            value: 'list',
            label: t('spaceExplorer.listView'),
            icon: <ListTree />,
            iconOnly: true,
          },
        ]}
        onValueChange={mode => onViewModeChange?.(mode)}
      />
    </div>
  )
}
