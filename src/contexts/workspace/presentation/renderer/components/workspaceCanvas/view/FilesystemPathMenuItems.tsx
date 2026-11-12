import React from 'react'
import { CopyIcon } from '@app/renderer/components/ui/pixelIcons'
import { MenuItem } from '@app/renderer/components/ui/Menu'
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
      <MenuItem icon={<CopyIcon />} onClick={onCopyRelativePath}>
        {t('spaceExplorer.copyRelativePath')}
      </MenuItem>
      <MenuItem icon={<CopyIcon />} onClick={onCopyAbsolutePath}>
        {t('spaceExplorer.copyAbsolutePath')}
      </MenuItem>
    </>
  )
}
