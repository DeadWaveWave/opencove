import type { JSX } from 'react'
import { File, FileArchive, FileSpreadsheet, FileText, Presentation } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { resolveFileContentDescriptor } from '../../../domain/fileContentType'
import { decodeUriPathname } from './DocumentNode.helpers'
import { DocumentNodeSystemOpen } from './DocumentNodeSystemOpen'

const fileIcons = {
  pdf: FileText,
  doc: FileText,
  docx: FileText,
  odt: FileText,
  xls: FileSpreadsheet,
  xlsx: FileSpreadsheet,
  ods: FileSpreadsheet,
  ppt: Presentation,
  pptx: Presentation,
  odp: Presentation,
  zip: FileArchive,
  rar: FileArchive,
  '7z': FileArchive,
  gz: FileArchive,
  bz2: FileArchive,
  xz: FileArchive,
  tar: FileArchive,
}

export function DocumentNodeFilePlaceholder({
  uri,
  mountId,
}: {
  uri: string
  mountId: string | null
}): JSX.Element {
  const { t } = useTranslation()
  const fileName = decodeUriPathname(uri).split('/').at(-1) || t('documentNode.title')
  const extension = /^.+\.([a-z0-9]{1,10})$/i.exec(fileName)?.[1].toLowerCase()
  const isUnsupportedFormat = resolveFileContentDescriptor(uri)?.kind === 'binary'
  const Icon =
    extension && Object.hasOwn(fileIcons, extension)
      ? fileIcons[extension as keyof typeof fileIcons]
      : File

  return (
    <div className="document-node__file-placeholder" data-testid="document-node-file-placeholder">
      <div className="document-node__file-icon" aria-hidden="true">
        <Icon size={36} strokeWidth={1.4} />
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
