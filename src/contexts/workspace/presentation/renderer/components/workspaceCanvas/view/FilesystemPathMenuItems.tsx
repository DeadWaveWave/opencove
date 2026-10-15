import React from 'react'
import { Copy } from 'lucide-react'
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
      <MenuItem icon={<Copy />} onClick={onCopyRelativePath}>
        {t('spaceExplorer.copyRelativePath')}
      </MenuItem>
      <MenuItem icon={<Copy />} onClick={onCopyAbsolutePath}>
        {t('spaceExplorer.copyAbsolutePath')}
      </MenuItem>
    </>
  )
}
