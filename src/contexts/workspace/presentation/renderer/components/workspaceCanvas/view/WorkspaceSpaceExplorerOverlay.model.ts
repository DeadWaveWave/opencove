import React from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { FileSystemEntry } from '@shared/contracts/dto'
import { toErrorMessage } from '../helpers'
import { isWithinRootUri, sortEntries } from './WorkspaceSpaceExplorerOverlay.helpers'

export type SpaceExplorerCreateMode = 'file' | 'directory' | null

export type SpaceExplorerRow =
  | { kind: 'entry'; entry: FileSystemEntry; depth: number; isExpanded: boolean }
  | { kind: 'state'; id: string; depth: number; stateKind: 'loading' | 'error'; message: string }

function validateCreateName(name: string): boolean {
  const trimmed = name.trim()
  if (trimmed.length === 0) {
    return false
  }
  if (trimmed === '.' || trimmed === '..') {
    return false
  }
  if (trimmed.includes('/') || trimmed.includes('\\')) {
    return false
  }
  return true
}

function buildChildUri(baseUri: string, name: string): string | null {
  try {
    const ensuredBase = baseUri.endsWith('/') ? baseUri : `${baseUri}/`
    return new URL(encodeURIComponent(name.trim()), ensuredBase).toString()
  } catch {
    return null
  }
}

export function useSpaceExplorerOverlayModel({
  rootUri,
  spaceId,
  onOpenFile,
}: {
  rootUri: string
  spaceId: string
  onOpenFile: (uri: string) => void
}): {
  isLoadingRoot: boolean
  rootError: string | null
  rows: SpaceExplorerRow[]
  selectedEntryUri: string | null
  refresh: () => void
  handleEntryActivate: (entry: FileSystemEntry) => void
  create: {
    mode: SpaceExplorerCreateMode
    draftName: string
    error: string | null
    isCreating: boolean
    start: (mode: Exclude<SpaceExplorerCreateMode, null>) => void
    cancel: () => void
    setDraftName: (value: string) => void
    submit: () => Promise<void>
  }
} {
  const { t } = useTranslation()

  const [refreshNonce, setRefreshNonce] = React.useState(0)
  const [expandedDirectoryUris, setExpandedDirectoryUris] = React.useState<Set<string>>(
    () => new Set(),
  )
  const [selectedEntryUri, setSelectedEntryUri] = React.useState<string | null>(null)
  const [selectedEntryKind, setSelectedEntryKind] = React.useState<FileSystemEntry['kind'] | null>(
    null,
  )

  const [createMode, setCreateMode] = React.useState<SpaceExplorerCreateMode>(null)
  const [createDraftName, setCreateDraftName] = React.useState('')
  const [createError, setCreateError] = React.useState<string | null>(null)
  const [isCreating, setIsCreating] = React.useState(false)

  const [directoryListings, setDirectoryListings] = React.useState<
    Record<
      string,
      {
        entries: FileSystemEntry[]
        isLoading: boolean
        error: string | null
      }
    >
  >(() => ({}))

  const loadDirectory = React.useCallback(
    async (uri: string): Promise<void> => {
      const api = window.opencoveApi?.filesystem
      if (!api) {
        setDirectoryListings(previous => ({
          ...previous,
          [uri]: {
            entries: [],
            isLoading: false,
            error: t('documentNode.filesystemUnavailable'),
          },
        }))
        return
      }

      setDirectoryListings(previous => ({
        ...previous,
        [uri]: {
          entries: previous[uri]?.entries ?? [],
          isLoading: true,
          error: null,
        },
      }))

      try {
        const result = await api.readDirectory({ uri })
        setDirectoryListings(previous => ({
          ...previous,
          [uri]: {
            entries: sortEntries(result.entries),
            isLoading: false,
            error: null,
          },
        }))
      } catch (readError) {
        setDirectoryListings(previous => ({
          ...previous,
          [uri]: {
            entries: [],
            isLoading: false,
            error: toErrorMessage(readError),
          },
        }))
      }
    },
    [t],
  )

  React.useEffect(() => {
    setExpandedDirectoryUris(new Set())
    setDirectoryListings({})
    setRefreshNonce(previous => previous + 1)
    setSelectedEntryUri(null)
    setSelectedEntryKind(null)
    setCreateMode(null)
    setCreateDraftName('')
    setCreateError(null)
    setIsCreating(false)
  }, [rootUri, spaceId])

  React.useEffect(() => {
    void loadDirectory(rootUri)
  }, [loadDirectory, refreshNonce, rootUri])

  React.useEffect(() => {
    expandedDirectoryUris.forEach(uri => {
      if (!isWithinRootUri(rootUri, uri)) {
        return
      }
      if (directoryListings[uri]) {
        return
      }
      void loadDirectory(uri)
    })
  }, [directoryListings, expandedDirectoryUris, loadDirectory, refreshNonce, rootUri])

  const refresh = React.useCallback(() => {
    setDirectoryListings({})
    setRefreshNonce(previous => previous + 1)
  }, [])

  const rootListing = directoryListings[rootUri] ?? null
  const isLoadingRoot = rootListing === null ? true : rootListing.isLoading
  const rootError = rootListing?.error ?? null

  const rows = React.useMemo<SpaceExplorerRow[]>(() => {
    if (!rootListing || rootListing.isLoading || rootListing.error) {
      return []
    }

    const list: SpaceExplorerRow[] = []
    const walk = (directoryUri: string, depth: number) => {
      const listing = directoryListings[directoryUri]
      if (!listing || listing.isLoading || listing.error) {
        return
      }

      for (const entry of listing.entries) {
        if (!isWithinRootUri(rootUri, entry.uri)) {
          continue
        }

        const isExpanded = entry.kind === 'directory' && expandedDirectoryUris.has(entry.uri)
        list.push({ kind: 'entry', entry, depth, isExpanded })

        if (entry.kind !== 'directory' || !isExpanded) {
          continue
        }

        const childListing = directoryListings[entry.uri]
        if (!childListing || childListing.isLoading) {
          list.push({
            kind: 'state',
            id: `${entry.uri}:loading`,
            depth: depth + 1,
            stateKind: 'loading',
            message: t('common.loading'),
          })
          continue
        }

        if (childListing.error) {
          list.push({
            kind: 'state',
            id: `${entry.uri}:error`,
            depth: depth + 1,
            stateKind: 'error',
            message: childListing.error,
          })
          continue
        }

        walk(entry.uri, depth + 1)
      }
    }

    walk(rootUri, 0)
    return list
  }, [directoryListings, expandedDirectoryUris, rootListing, rootUri, t])

  const resolveCreateBaseUri = React.useCallback((): string => {
    if (selectedEntryUri && selectedEntryKind === 'directory') {
      return selectedEntryUri
    }

    if (selectedEntryUri && selectedEntryKind === 'file') {
      try {
        return new URL('.', selectedEntryUri).toString().replace(/\/$/, '')
      } catch {
        return rootUri
      }
    }

    return rootUri
  }, [rootUri, selectedEntryKind, selectedEntryUri])

  const submitCreate = React.useCallback(async (): Promise<void> => {
    const mode = createMode
    if (!mode) {
      return
    }

    const api = window.opencoveApi?.filesystem
    if (!api) {
      setCreateError(t('documentNode.filesystemUnavailable'))
      return
    }

    if (!validateCreateName(createDraftName)) {
      setCreateError(t('spaceExplorer.invalidName'))
      return
    }

    const baseUri = resolveCreateBaseUri()
    const targetUri = buildChildUri(baseUri, createDraftName)
    if (!targetUri) {
      setCreateError(t('spaceExplorer.createFailed'))
      return
    }

    setIsCreating(true)
    setCreateError(null)

    try {
      if (mode === 'directory') {
        if (typeof api.createDirectory !== 'function') {
          throw new Error(t('documentNode.filesystemUnavailable'))
        }
        await api.createDirectory({ uri: targetUri })
      } else {
        await api.writeFileText({ uri: targetUri, content: '' })
      }

      setExpandedDirectoryUris(previous => {
        const next = new Set(previous)
        if (isWithinRootUri(rootUri, baseUri) && baseUri !== rootUri) {
          next.add(baseUri)
        }
        return next
      })

      await loadDirectory(baseUri)
      setSelectedEntryUri(targetUri)
      setSelectedEntryKind(mode === 'directory' ? 'directory' : 'file')
      setCreateMode(null)
      setCreateDraftName('')
    } catch (error) {
      setCreateError(toErrorMessage(error))
    } finally {
      setIsCreating(false)
    }
  }, [createDraftName, createMode, loadDirectory, resolveCreateBaseUri, rootUri, t])

  const create = React.useMemo(
    () => ({
      mode: createMode,
      draftName: createDraftName,
      error: createError,
      isCreating,
      start: (mode: Exclude<SpaceExplorerCreateMode, null>) => {
        setCreateMode(mode)
        setCreateDraftName('')
        setCreateError(null)
      },
      cancel: () => {
        setCreateMode(null)
        setCreateDraftName('')
        setCreateError(null)
      },
      setDraftName: (value: string) => {
        setCreateDraftName(value)
        if (createError) {
          setCreateError(null)
        }
      },
      submit: submitCreate,
    }),
    [createDraftName, createError, createMode, isCreating, submitCreate],
  )

  const handleEntryActivate = React.useCallback(
    (entry: FileSystemEntry) => {
      setSelectedEntryUri(entry.uri)
      setSelectedEntryKind(entry.kind)

      if (entry.kind === 'directory') {
        if (!isWithinRootUri(rootUri, entry.uri)) {
          return
        }
        setExpandedDirectoryUris(previous => {
          const next = new Set(previous)
          if (next.has(entry.uri)) {
            next.delete(entry.uri)
          } else {
            next.add(entry.uri)
          }
          return next
        })
        return
      }

      if (!isWithinRootUri(rootUri, entry.uri)) {
        return
      }

      onOpenFile(entry.uri)
    },
    [onOpenFile, rootUri],
  )

  return {
    isLoadingRoot,
    rootError,
    rows,
    selectedEntryUri,
    refresh,
    handleEntryActivate,
    create,
  }
}
