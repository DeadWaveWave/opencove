import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import { resolveFilesystemApiForMount } from '../../../utils/mountAwareFilesystemApi'
import { toErrorMessage } from '../helpers'
import { isWithinRootUri, sortEntries } from './WorkspaceSpaceExplorerOverlay.helpers'

type DirectoryListing = {
  entries: FileSystemEntry[]
  isLoading: boolean
  error: string | null
}

export function useDirectoryListings({
  rootUri,
  mountId,
  expandedDirectoryUris,
}: {
  rootUri: string
  mountId: string | null
  expandedDirectoryUris: Set<string>
}) {
  const { t } = useTranslation()
  const [directoryListings, setDirectoryListings] = React.useState<
    Record<string, DirectoryListing>
  >({})
  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const generation = React.useRef(0)
  const requests = React.useRef(new Set<string>())

  const loadDirectory = React.useCallback(
    async (uri: string) => {
      if (requests.current.has(uri)) {
        return
      }
      const requestGeneration = generation.current
      requests.current.add(uri)
      setDirectoryListings(previous => ({
        ...previous,
        [uri]: { entries: previous[uri]?.entries ?? [], isLoading: true, error: null },
      }))
      let listing: DirectoryListing
      try {
        const api = resolveFilesystemApiForMount(mountId)
        if (!api) {
          throw new Error(t('documentNode.filesystemUnavailable'))
        }
        const result = await api.readDirectory({ uri })
        listing = { entries: sortEntries(result.entries), isLoading: false, error: null }
      } catch (error) {
        listing = { entries: [], isLoading: false, error: toErrorMessage(error) }
      }
      if (generation.current !== requestGeneration) {
        return
      }
      requests.current.delete(uri)
      setDirectoryListings(previous => ({ ...previous, [uri]: listing }))
    },
    [mountId, t],
  )

  React.useEffect(() => {
    const pending = requests.current
    generation.current += 1
    pending.clear()
    setDirectoryListings({})
    void loadDirectory(rootUri)
    return () => {
      generation.current += 1
      pending.clear()
    }
  }, [loadDirectory, refreshNonce, rootUri])

  React.useEffect(() => {
    for (const uri of expandedDirectoryUris) {
      if (isWithinRootUri(rootUri, uri) && !directoryListings[uri]) {
        void loadDirectory(uri)
      }
    }
  }, [directoryListings, expandedDirectoryUris, loadDirectory, rootUri])

  const refresh = React.useCallback(() => {
    // Invalidate pending reads immediately, before React schedules the next render.
    generation.current += 1
    requests.current.clear()
    setDirectoryListings({})
    setRefreshNonce(previous => previous + 1)
  }, [])
  return { directoryListings, refresh }
}

export function useDirectoryExpansion({
  rootUri,
  expandedUris,
  onExpandedUrisChange,
}: {
  rootUri: string
  expandedUris?: string[]
  onExpandedUrisChange?: (uris: string[]) => void
}): [Set<string>, React.Dispatch<React.SetStateAction<Set<string>>>] {
  const [local, setLocal] = React.useState<Set<string>>(() => new Set())
  const expanded = React.useMemo(
    () => (expandedUris ? new Set(expandedUris) : local),
    [expandedUris, local],
  )
  const latest = React.useRef(expanded)
  latest.current = expanded
  const update = React.useCallback<React.Dispatch<React.SetStateAction<Set<string>>>>(
    action => {
      const previous = latest.current
      const next = typeof action === 'function' ? action(previous) : action
      if (next.size === previous.size && [...next].every(uri => previous.has(uri))) {
        return
      }
      latest.current = next
      if (onExpandedUrisChange) {
        onExpandedUrisChange([...next])
      } else {
        setLocal(next)
      }
    },
    [onExpandedUrisChange],
  )
  React.useEffect(() => {
    if (!expandedUris) {
      setLocal(new Set())
    }
  }, [rootUri, expandedUris])
  return [expanded, update]
}
