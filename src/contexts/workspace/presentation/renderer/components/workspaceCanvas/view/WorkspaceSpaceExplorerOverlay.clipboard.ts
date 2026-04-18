import type { TranslateFn } from '@app/renderer/i18n'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { toErrorMessage } from '../helpers'
import {
  resolveEntryAbsolutePath,
  resolveEntryRelativePath,
} from './WorkspaceSpaceExplorerOverlay.operations'

interface CopyExplorerPathOptions {
  uri?: string
  rootUri: string
  selectedEntryUri: string | null
  closeContextMenu: () => void
  t: TranslateFn
  onShowMessage?: ShowWorkspaceCanvasMessage
}

export async function copyExplorerAbsolutePath({
  uri,
  rootUri,
  selectedEntryUri,
  closeContextMenu,
  t,
  onShowMessage,
}: CopyExplorerPathOptions): Promise<void> {
  closeContextMenu()
  const path = resolveEntryAbsolutePath(uri ?? selectedEntryUri ?? rootUri)
  if (!path) {
    onShowMessage?.(t('spaceExplorer.copyPathFailed'), 'error')
    return
  }

  try {
    const copyPathApi = window.opencoveApi?.workspace?.copyPath
    if (typeof copyPathApi === 'function') {
      await copyPathApi({ path })
    } else {
      await window.opencoveApi.clipboard.writeText(path)
    }
    onShowMessage?.(t('spaceExplorer.pathCopied'))
  } catch (error) {
    onShowMessage?.(toErrorMessage(error), 'error')
  }
}

export async function copyExplorerRelativePath({
  uri,
  rootUri,
  selectedEntryUri,
  closeContextMenu,
  t,
  onShowMessage,
}: CopyExplorerPathOptions): Promise<void> {
  closeContextMenu()
  const relativePath = resolveEntryRelativePath(rootUri, uri ?? selectedEntryUri ?? rootUri)
  if (!relativePath) {
    onShowMessage?.(t('spaceExplorer.copyRelativePathFailed'), 'error')
    return
  }

  try {
    await window.opencoveApi.clipboard.writeText(relativePath)
    onShowMessage?.(t('spaceExplorer.pathCopied'))
  } catch (error) {
    onShowMessage?.(toErrorMessage(error), 'error')
  }
}
