import type { DocumentNodeMediaKind } from './DocumentNode.media'

export interface DocumentNodeLoadMessages {
  notAFile: string
  binaryReadUnavailable: string
}

export type DocumentNodeUnsupportedKind = 'binary' | 'tooLarge' | 'imageTooLarge'

export interface LoadedDocumentMediaSource {
  kind: DocumentNodeMediaKind
  mimeType: string
  url: string
}
