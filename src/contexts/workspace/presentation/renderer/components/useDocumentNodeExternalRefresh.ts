import { useEffect } from 'react'
import type { MutableRefObject } from 'react'
import type { FileSystemStat } from '@shared/contracts/dto'
import type { DocumentNodeLoadMessages } from './DocumentNode.shared'
import type { DocumentNodeLoadResult } from './DocumentNode.helpers'
import type { DocumentNodeUnsupportedKind, LoadedDocumentMediaSource } from './DocumentNode.shared'
import { loadDocumentNodeContent } from './DocumentNode.helpers'
import { resolveDocumentNodeExternalRefreshDecision } from './DocumentNode.sync'
import { resolveFilesystemApiForMount } from '../utils/mountAwareFilesystemApi'

export interface DocumentNodeExternalRefreshState {
  content: string
  savedContent: string
  isLoading: boolean
  isSaving: boolean
  loadError: string | null
  unsupportedKind: DocumentNodeUnsupportedKind | null
  mediaSource: LoadedDocumentMediaSource | null
  mediaLoadError: boolean
  lastKnownDiskStat: FileSystemStat | null
  externalConflictStat: FileSystemStat | null
}

export function useDocumentNodeExternalRefresh({
  mountId,
  uri,
  intervalMs,
  isLoading,
  loadError,
  unsupportedKind,
  mediaSource,
  mediaLoadError,
  loadMessages,
  latestStateRef,
  applyLoadedResult,
  setHasExternalConflict,
  setExternalConflictStat,
}: {
  mountId: string | null
  uri: string
  intervalMs: number
  isLoading: boolean
  loadError: string | null
  unsupportedKind: DocumentNodeUnsupportedKind | null
  mediaSource: LoadedDocumentMediaSource | null
  mediaLoadError: boolean
  loadMessages: DocumentNodeLoadMessages
  latestStateRef: MutableRefObject<DocumentNodeExternalRefreshState>
  applyLoadedResult: (result: DocumentNodeLoadResult) => void
  setHasExternalConflict: (next: boolean) => void
  setExternalConflictStat: (next: FileSystemStat | null) => void
}): void {
  useEffect(() => {
    if (isLoading || loadError || unsupportedKind || mediaSource || mediaLoadError) {
      return
    }

    let disposed = false
    let inFlight = false
    let queued = false

    const runCheck = async (): Promise<void> => {
      if (inFlight) {
        queued = true
        return
      }

      inFlight = true

      try {
        const latest = latestStateRef.current
        if (
          disposed ||
          latest.isLoading ||
          latest.isSaving ||
          latest.loadError ||
          latest.unsupportedKind ||
          latest.mediaSource ||
          latest.mediaLoadError
        ) {
          return
        }

        const filesystemApi = resolveFilesystemApiForMount(mountId)
        if (!filesystemApi) {
          return
        }

        const stat = await filesystemApi.stat({ uri })
        if (disposed) {
          return
        }

        const current = latestStateRef.current
        const decision = resolveDocumentNodeExternalRefreshDecision({
          currentStat: current.lastKnownDiskStat,
          observedStat: stat,
          conflictStat: current.externalConflictStat,
          isDirty: current.content !== current.savedContent,
        })

        if (decision === 'unchanged') {
          return
        }

        if (decision === 'conflict') {
          setHasExternalConflict(true)
          setExternalConflictStat(stat)
          return
        }

        const result = await loadDocumentNodeContent(filesystemApi, uri, loadMessages)
        if (disposed) {
          return
        }

        const afterLoad = latestStateRef.current
        if (afterLoad.content !== afterLoad.savedContent) {
          setHasExternalConflict(true)
          setExternalConflictStat(result.stat)
          return
        }

        applyLoadedResult(result)
      } catch {
        // Ignore background refresh failures; the visible state remains usable.
      } finally {
        inFlight = false

        if (queued && !disposed) {
          queued = false
          void runCheck()
        }
      }
    }

    const handleVisibilityChange = (): void => {
      if (document.visibilityState !== 'visible') {
        return
      }

      void runCheck()
    }

    const intervalId = window.setInterval(() => {
      void runCheck()
    }, intervalMs)

    const unsubscribe = window.opencoveApi.sync.onStateUpdated(() => {
      void runCheck()
    })

    window.addEventListener('focus', handleVisibilityChange)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    void runCheck()

    return () => {
      disposed = true
      unsubscribe()
      window.clearInterval(intervalId)
      window.removeEventListener('focus', handleVisibilityChange)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [
    applyLoadedResult,
    intervalMs,
    isLoading,
    loadError,
    loadMessages,
    mediaLoadError,
    mediaSource,
    mountId,
    latestStateRef,
    setExternalConflictStat,
    setHasExternalConflict,
    unsupportedKind,
    uri,
  ])
}
