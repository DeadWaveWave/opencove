import type { WebsiteWindowManager } from './WebsiteWindowManager'
import type { RespondBrowserPermissionInput } from '../../../shared/contracts/dto'

const managers = new Set<WebsiteWindowManager>()

export function registerWebsiteWindowManager(manager: WebsiteWindowManager): () => void {
  managers.add(manager)
  return () => {
    managers.delete(manager)
  }
}

export async function closeWebsiteWindowNodeAcrossManagers(nodeId: string): Promise<void> {
  await Promise.allSettled(
    [...managers].map(async manager => {
      await Promise.resolve(manager.close(nodeId))
    }),
  )
}

export function cancelWebsiteWindowDownloadAcrossManagers(downloadId: string): void {
  for (const manager of managers) {
    manager.cancelDownload(downloadId)
  }
}

export function respondWebsiteWindowPermissionAcrossManagers(
  response: RespondBrowserPermissionInput,
): void {
  for (const manager of managers) {
    manager.respondPermissionRequest(response)
  }
}
