import { useCallback } from 'react'
import type { WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

export function useWorkspaceCanvasWebsiteNodeMutations({
  setNodes,
  onRequestPersistFlush,
}: {
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  onRequestPersistFlush?: () => void
}): Pick<
  UseWorkspaceCanvasNodesStoreResult,
  'updateWebsiteUrl' | 'setWebsitePinned' | 'setWebsiteSession'
> {
  const updateWebsiteUrl = useCallback(
    (nodeId: string, url: string) => {
      const normalizedNodeId = nodeId.trim()
      if (normalizedNodeId.length === 0) {
        return
      }

      const normalizedUrl = url.trim()

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== normalizedNodeId || node.data.kind !== 'website') {
              return node
            }

            if (node.data.website?.url === normalizedUrl) {
              return node
            }

            const previousWebsite = node.data.website
            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                website: {
                  url: normalizedUrl,
                  pinned: previousWebsite?.pinned ?? false,
                  sessionMode: previousWebsite?.sessionMode ?? 'shared',
                  profileId: previousWebsite?.profileId ?? null,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const setWebsitePinned = useCallback(
    (nodeId: string, pinned: boolean) => {
      const normalizedNodeId = nodeId.trim()
      if (normalizedNodeId.length === 0) {
        return
      }

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== normalizedNodeId || node.data.kind !== 'website') {
              return node
            }

            const previousWebsite = node.data.website
            if (previousWebsite?.pinned === pinned) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                website: {
                  url: previousWebsite?.url ?? '',
                  pinned,
                  sessionMode: previousWebsite?.sessionMode ?? 'shared',
                  profileId: previousWebsite?.profileId ?? null,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  const setWebsiteSession = useCallback(
    (nodeId: string, sessionMode: WebsiteWindowSessionMode, profileId: string | null) => {
      const normalizedNodeId = nodeId.trim()
      if (normalizedNodeId.length === 0) {
        return
      }

      setNodes(
        prevNodes => {
          let hasChanged = false

          const nextNodes = prevNodes.map(node => {
            if (node.id !== normalizedNodeId || node.data.kind !== 'website') {
              return node
            }

            const previousWebsite = node.data.website
            if (
              previousWebsite?.sessionMode === sessionMode &&
              (previousWebsite?.profileId ?? null) === profileId
            ) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                website: {
                  url: previousWebsite?.url ?? '',
                  pinned: previousWebsite?.pinned ?? false,
                  sessionMode,
                  profileId,
                },
              },
            }
          })

          return hasChanged ? nextNodes : prevNodes
        },
        { syncLayout: false },
      )

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  return { updateWebsiteUrl, setWebsitePinned, setWebsiteSession }
}
