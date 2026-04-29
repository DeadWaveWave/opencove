import type { WebsiteWindowManager } from './WebsiteWindowManager'

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
