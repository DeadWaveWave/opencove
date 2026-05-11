import { useCallback } from 'react'
import type { BrowserMode, WebsiteWindowSessionMode } from '@shared/contracts/dto'
import type { NodeFrame } from '../../../types'
import { createWebsiteNodeData } from '../../../utils/websiteNodeData'
import type { UseWorkspaceCanvasNodesStoreResult } from './useNodesStore.types'

export function useWorkspaceCanvasWebsiteNodeMutations({
  setNodes,
  onRequestPersistFlush,
}: {
  setNodes: UseWorkspaceCanvasNodesStoreResult['setNodes']
  onRequestPersistFlush?: () => void
}): Pick<
  UseWorkspaceCanvasNodesStoreResult,
  | 'updateWebsiteUrl'
  | 'setWebsitePinned'
  | 'setWebsiteSession'
  | 'setWebsiteMode'
  | 'setWebsiteFullscreen'
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
                website: createWebsiteNodeData({
                  ...previousWebsite,
                  url: normalizedUrl,
                }),
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
                website: createWebsiteNodeData({
                  ...previousWebsite,
                  pinned,
                }),
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
                website: createWebsiteNodeData({
                  ...previousWebsite,
                  sessionMode,
                  profileId,
                }),
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

  const setWebsiteMode = useCallback(
    (nodeId: string, browserMode: BrowserMode) => {
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
            if (previousWebsite?.browserMode === browserMode) {
              return node
            }

            hasChanged = true
            return {
              ...node,
              data: {
                ...node.data,
                website: createWebsiteNodeData({ ...previousWebsite, browserMode }),
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

  const setWebsiteFullscreen = useCallback(
    (nodeId: string, frame: NodeFrame, previousFrame: NodeFrame | null, isFullscreen: boolean) => {
      const normalizedNodeId = nodeId.trim()
      if (normalizedNodeId.length === 0) {
        return
      }

      setNodes(prevNodes => {
        let hasChanged = false
        const nextNodes = prevNodes.map(node => {
          if (node.id !== normalizedNodeId || node.data.kind !== 'website') {
            return node
          }

          const previousWebsite = node.data.website
          hasChanged = true
          return {
            ...node,
            position: frame.position,
            data: {
              ...node.data,
              width: frame.size.width,
              height: frame.size.height,
              website: createWebsiteNodeData({
                ...previousWebsite,
                isFullscreen,
                previousFrame,
              }),
            },
          }
        })

        return hasChanged ? nextNodes : prevNodes
      })

      onRequestPersistFlush?.()
    },
    [onRequestPersistFlush, setNodes],
  )

  return {
    updateWebsiteUrl,
    setWebsitePinned,
    setWebsiteSession,
    setWebsiteMode,
    setWebsiteFullscreen,
  }
}
