import React from 'react'
import { useTranslation } from '@app/renderer/i18n'

export function WorkspaceEmptyState({
  onAddWorkspace,
}: {
  onAddWorkspace: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="workspace-empty-state">
      <h2>{t('workspaceEmptyState.title')}</h2>
      <p>{t('workspaceEmptyState.description')}</p>
      <button type="button" onClick={onAddWorkspace}>
        {t('workspaceEmptyState.action')}
      </button>
    </div>
  )
}
