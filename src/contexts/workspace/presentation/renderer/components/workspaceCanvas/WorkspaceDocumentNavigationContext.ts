import { createContext } from 'react'
import type { TerminalFileLinkOpenRequest } from '@shared/types/terminalLinkNavigation'
import type { DocumentNavigationIntent } from '../../../../domain/documentNavigation'

export interface WorkspaceDocumentNavigation {
  openFileLink: (sourceNodeId: string, request: TerminalFileLinkOpenRequest) => Promise<boolean>
  navigationByNode: ReadonlyMap<string, DocumentNavigationIntent>
  acknowledgeNavigation: (nodeId: string, requestId: number) => void
  directoryTarget: { spaceId: string; mountId: string | null; uri: string } | null
}

export const WorkspaceDocumentNavigationContext = createContext<WorkspaceDocumentNavigation | null>(
  null,
)
