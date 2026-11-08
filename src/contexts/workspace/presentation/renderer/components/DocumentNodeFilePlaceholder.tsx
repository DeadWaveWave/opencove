import type { JSX } from 'react'
import {
  FileArchiveIcon,
  FileIcon,
  FileSheetIcon,
  FileTextIcon,
  PresentationIcon,
} from '@app/renderer/components/ui/pixelIcons'
import { useTranslation } from '@app/renderer/i18n'
import { resolveFileContentDescriptor } from '../../../domain/fileContentType'
import { decodeUriPathname } from './DocumentNode.helpers'
import { DocumentNodeSystemOpen } from './DocumentNodeSystemOpen'

const fileIcons = {
  pdf: FileTextIcon,
  doc: FileTextIcon,
  docx: FileTextIcon,
  odt: FileTextIcon,
  xls: FileSheetIcon,
  xlsx: FileSheetIcon,
  ods: FileSheetIcon,
  ppt: PresentationIcon,
  pptx: PresentationIcon,
  odp: PresentationIcon,
  zip: FileArchiveIcon,
  rar: FileArchiveIcon,
  '7z': FileArchiveIcon,
  gz: FileArchiveIcon,
  bz2: FileArchiveIcon,
  xz: FileArchiveIcon,
  tar: FileArchiveIcon,
}

export function DocumentNodeFilePlaceholder({
  uri,
  mountId,
}: {
  uri: string
  mountId: string | null | undefined
}): JSX.Element {
  const { t } = useTranslation()
  const fileName = decodeUriPathname(uri).split('/').at(-1) || t('documentNode.title')
  const extension = /^.+\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1].toLowerCase()
  const isUnsupportedFormat = resolveFileContentDescriptor(uri)?.kind === 'binary'
  const Icon =
    extension && Object.hasOwn(fileIcons, extension)
      ? fileIcons[extension as keyof typeof fileIcons]
      : FileIcon

  return (
    <div className="document-node__file-placeholder" data-testid="document-node-file-placeholder">
      <div className="document-node__file-icon" aria-hidden="true">
        <Icon size={36} />
      </div>
      <div className="document-node__file-details">
        <div
          className="document-node__file-name"
          data-testid="document-node-file-name"
          title={fileName}
        >
          {fileName}
        </div>
        <div
          className="document-node__file-message"
          data-testid="document-node-file-preview-message"
        >
          {isUnsupportedFormat && extension
            ? t('documentNode.previewUnavailableForType', { fileType: extension.toUpperCase() })
            : t('documentNode.binaryTitle')}
        </div>
        <div className="document-node__file-hint">{t('documentNode.binaryMessage')}</div>
      </div>
      <DocumentNodeSystemOpen uri={uri} mountId={mountId} />
    </div>
  )
}
