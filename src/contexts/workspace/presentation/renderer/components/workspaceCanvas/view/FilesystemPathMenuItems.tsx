import React from 'react'
import { Copy } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'

export function FilesystemPathMenuItems({
  onCopyAbsolutePath,
  onCopyRelativePath,
}: {
  onCopyAbsolutePath: () => void
  onCopyRelativePath: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <button type="button" onClick={onCopyRelativePath}>
        <Copy className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('spaceExplorer.copyRelativePath')}</span>
      </button>
      <button type="button" onClick={onCopyAbsolutePath}>
        <Copy className="workspace-context-menu__icon" aria-hidden="true" />
        <span className="workspace-context-menu__label">{t('spaceExplorer.copyAbsolutePath')}</span>
      </button>
    </>
  )
}
