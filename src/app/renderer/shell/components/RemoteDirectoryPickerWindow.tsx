import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  FileSystemEntry,
  GetEndpointHomeDirectoryResult,
  ReadEndpointDirectoryResult,
  RepairWorkerEndpointInput,
} from '@shared/contracts/dto'
import { fromFileUri } from '@contexts/filesystem/domain/fileUri'
import { toErrorMessage } from '../utils/format'
import {
  getEndpointActionExecution,
  getEndpointTechnicalDetails,
} from '../utils/endpointOverviewUi'
import { dirname, isAbsolutePath, normalizeSlashes } from '../utils/pathHelpers'
import { useEndpointOverviews } from '../hooks/useEndpointOverviews'
import { RemoteEndpointStatusPanel } from './RemoteEndpointStatusPanel'

function sortEntries(a: FileSystemEntry, b: FileSystemEntry): number {
  const aIsDirectory = a.kind === 'directory'
  const bIsDirectory = b.kind === 'directory'
  if (aIsDirectory !== bIsDirectory) {
    return aIsDirectory ? -1 : 1
  }

  return a.name.localeCompare(b.name)
}

function toBrowsableEntries(entries: FileSystemEntry[]): FileSystemEntry[] {
  return entries
    .filter(entry => entry.kind !== 'file')
    .slice()
    .sort(sortEntries)
}

export function RemoteDirectoryPickerWindow({
  isOpen,
  endpointId,
  endpointLabel,
  initialPath,
  onCancel,
  onSelect,
}: {
  isOpen: boolean
  endpointId: string
  endpointLabel: string
  initialPath: string | null
  onCancel: () => void
  onSelect: (path: string) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const requestCounterRef = useRef(0)
  const pathInputElementRef = useRef<HTMLInputElement | null>(null)
  const generationRef = useRef(0)
  const didLoadInitialRef = useRef(false)
  const openQueryRevisionRef = useRef(0)
  const {
    overviewByEndpointId,
    observationRevision,
    busyByEndpointId,
    prepareEndpoint,
    repairEndpoint,
    reload,
    error: monitorError,
  } = useEndpointOverviews({ enabled: isOpen })
  const latestObservationRevisionRef = useRef(observationRevision)
  latestObservationRevisionRef.current = observationRevision
  const overview = overviewByEndpointId.get(endpointId) ?? null
  const [currentPath, setCurrentPath] = useState<string>('')
  const [pathInput, setPathInput] = useState('')
  const [entries, setEntries] = useState<FileSystemEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isLoadingDirectory, setIsLoadingDirectory] = useState(false)
  const isBusy =
    isLoadingDirectory || Boolean(busyByEndpointId[endpointId]) || Boolean(overview?.operation)

  const refreshCandidate = useMemo(() => {
    if (pathInput.trim().length > 0) {
      return pathInput
    }

    return currentPath
  }, [currentPath, pathInput])

  const shouldShowGoLabel = useMemo(() => {
    const typed = normalizeSlashes(pathInput.trim())
    if (typed.length === 0) {
      return false
    }

    const current = normalizeSlashes(currentPath.trim())
    return typed !== current
  }, [currentPath, pathInput])

  const parentPath = useMemo(() => {
    const parent = dirname(currentPath)
    return parent && parent !== currentPath ? parent : null
  }, [currentPath])

  const canBrowse =
    overview?.canBrowse === true && observationRevision > openQueryRevisionRef.current
  const technicalDetails = overview ? getEndpointTechnicalDetails(overview) : []

  const loadDirectory = useCallback(
    async (path: string): Promise<void> => {
      const trimmed = normalizeSlashes(path.trim())
      if (trimmed.length === 0) {
        return
      }

      if (!isAbsolutePath(trimmed)) {
        setError(t('remoteDirectoryPicker.pathMustBeAbsolute'))
        return
      }

      const requestId = (requestCounterRef.current += 1)
      setIsLoadingDirectory(true)
      setError(null)

      try {
        const result = await window.opencoveApi.controlSurface.invoke<ReadEndpointDirectoryResult>({
          kind: 'query',
          id: 'endpoint.readDirectory',
          payload: { endpointId, path: trimmed },
        })

        if (requestCounterRef.current !== requestId) {
          return
        }

        setCurrentPath(trimmed)
        setPathInput(trimmed)
        setEntries(toBrowsableEntries(result.entries ?? []))
      } catch (caughtError) {
        if (requestCounterRef.current !== requestId) {
          return
        }

        setError(toErrorMessage(caughtError))
      } finally {
        if (requestCounterRef.current === requestId) {
          setIsLoadingDirectory(false)
        }
      }
    },
    [endpointId, t],
  )

  const loadInitialDirectory = useCallback(async (): Promise<void> => {
    const preferred = normalizeSlashes((initialPath ?? '').trim())
    if (preferred.length > 0 && isAbsolutePath(preferred)) {
      await loadDirectory(preferred)
      return
    }

    const generation = generationRef.current
    const requestId = requestCounterRef.current
    setIsLoadingDirectory(true)
    try {
      const resolved =
        await window.opencoveApi.controlSurface.invoke<GetEndpointHomeDirectoryResult>({
          kind: 'query',
          id: 'endpoint.homeDirectory',
          payload: { endpointId },
        })
      if (generation !== generationRef.current || requestId !== requestCounterRef.current) {
        return
      }
      const home =
        typeof resolved.homeDirectory === 'string' && resolved.homeDirectory.trim().length > 0
          ? resolved.homeDirectory.trim()
          : '/'
      await loadDirectory(home)
    } catch {
      if (generation !== generationRef.current || requestId !== requestCounterRef.current) {
        return
      }
      await loadDirectory('/')
    }
  }, [endpointId, initialPath, loadDirectory])

  const handlePrepare = useCallback(
    async (reason: 'connect' | 'browse' | 'reconnect') => {
      const generation = generationRef.current
      didLoadInitialRef.current = false
      setError(null)
      try {
        await prepareEndpoint({ endpointId, reason })
      } catch (caughtError) {
        if (generation === generationRef.current) {
          setError(toErrorMessage(caughtError))
        }
      }
    },
    [endpointId, prepareEndpoint],
  )

  const handleRepair = useCallback(
    async (action: RepairWorkerEndpointInput['action']) => {
      const generation = generationRef.current
      didLoadInitialRef.current = false
      setError(null)
      try {
        await repairEndpoint({ endpointId, action })
      } catch (caughtError) {
        if (generation === generationRef.current) {
          setError(toErrorMessage(caughtError))
        }
      }
    },
    [endpointId, repairEndpoint],
  )

  const runRecommendedAction = useCallback(async () => {
    if (!overview) {
      return
    }

    const action = getEndpointActionExecution(overview.recommendedAction)
    if (!action) {
      return
    }

    if (action.kind === 'prepare') {
      await handlePrepare(action.reason)
      return
    }

    await handleRepair(action.action)
  }, [handlePrepare, handleRepair, overview])

  useLayoutEffect(() => {
    // Cache can paint continuity, but only a query after this open can authorize browsing.
    openQueryRevisionRef.current = latestObservationRevisionRef.current
    generationRef.current += 1
    requestCounterRef.current += 1
    didLoadInitialRef.current = false
    setError(null)
    setEntries([])
    setCurrentPath('')
    setPathInput('')
    setIsLoadingDirectory(false)
    return () => {
      generationRef.current += 1
      requestCounterRef.current += 1
    }
  }, [endpointId, isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }
    const generation = generationRef.current
    void reload().then(overviews => {
      if (generation !== generationRef.current) {
        return
      }
      const current = overviews?.find(item => item.endpoint.endpointId === endpointId)
      if (current && !current.operation && !current.canBrowse) {
        void handlePrepare('browse')
      }
    })
  }, [endpointId, handlePrepare, isOpen, reload])

  useEffect(() => {
    if (!isOpen || !canBrowse || isBusy || didLoadInitialRef.current) {
      return
    }
    didLoadInitialRef.current = true
    void loadInitialDirectory()
  }, [canBrowse, isBusy, isOpen, loadInitialDirectory])

  const closePicker = () => {
    generationRef.current += 1
    requestCounterRef.current += 1
    onCancel()
  }

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="cove-window-backdrop remote-directory-picker-backdrop"
      data-testid="remote-directory-picker-backdrop"
      onClick={closePicker}
    >
      <section
        className="cove-window cove-window--xwide"
        data-testid="remote-directory-picker-window"
        onClick={event => event.stopPropagation()}
      >
        <h3>{t('remoteDirectoryPicker.title')}</h3>
        <p className="cove-window__intro">
          {t('remoteDirectoryPicker.description', { endpoint: endpointLabel })}
        </p>

        <div className="cove-window__fields">
          {error || monitorError ? (
            <p className="cove-window__error" data-testid="remote-directory-picker-error">
              {error ?? monitorError}
            </p>
          ) : null}

          <div className="cove-window__section-card">
            {overview ? (
              <RemoteEndpointStatusPanel
                t={t}
                overview={overview}
                compact
                showIdentity={false}
                isBusy={isBusy}
                testIdPrefix="remote-directory-picker-status"
                onRunRecommendedAction={() => {
                  void runRecommendedAction()
                }}
                onReconnect={() => {
                  void handlePrepare('reconnect')
                }}
              />
            ) : null}

            <div className="cove-window__field-row">
              <label htmlFor="remote-directory-picker-path">
                {t('remoteDirectoryPicker.pathLabel')}
              </label>
              <div className="cove-window__path-row">
                <input
                  id="remote-directory-picker-path"
                  className="cove-field"
                  type="text"
                  ref={pathInputElementRef}
                  value={pathInput}
                  disabled={isBusy || !canBrowse}
                  placeholder={t('remoteDirectoryPicker.pathPlaceholder')}
                  data-testid="remote-directory-picker-path"
                  onChange={event => setPathInput(event.target.value)}
                  onKeyDown={event => {
                    if (event.key !== 'Enter' || event.nativeEvent.isComposing) {
                      return
                    }

                    event.preventDefault()
                    void loadDirectory(event.currentTarget.value)
                  }}
                />
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || !canBrowse || !parentPath}
                  data-testid="remote-directory-picker-up"
                  onClick={() => {
                    if (!parentPath) {
                      return
                    }

                    void loadDirectory(parentPath)
                  }}
                >
                  {t('remoteDirectoryPicker.upAction')}
                </button>
                <button
                  type="button"
                  className="cove-window__action cove-window__action--ghost"
                  disabled={isBusy || !canBrowse || refreshCandidate.trim().length === 0}
                  data-testid="remote-directory-picker-refresh"
                  onClick={() => {
                    const typed = pathInputElementRef.current?.value ?? ''
                    const target = typed.trim().length > 0 ? typed : currentPath
                    void loadDirectory(target)
                  }}
                >
                  {shouldShowGoLabel ? t('remoteDirectoryPicker.goAction') : t('common.refresh')}
                </button>
              </div>
            </div>
          </div>

          <div className="cove-window__field-row">
            <label>{t('remoteDirectoryPicker.foldersLabel')}</label>
            <div className="remote-directory-picker__list">
              <div className="remote-directory-picker__entries">
                {entries.length === 0 ? (
                  <div
                    className="remote-directory-picker__empty"
                    data-testid="remote-directory-picker-empty"
                  >
                    {isBusy
                      ? t('common.loading')
                      : canBrowse
                        ? t('remoteDirectoryPicker.empty')
                        : overview
                          ? t('remoteDirectoryPicker.waitForConnection')
                          : t('remoteDirectoryPicker.preparing')}
                  </div>
                ) : (
                  entries.map((entry, index) => (
                    <button
                      key={entry.uri}
                      type="button"
                      disabled={isBusy || !canBrowse}
                      data-testid={`remote-directory-picker-entry-${String(index)}`}
                      onClick={() => {
                        const resolved = fromFileUri(entry.uri)
                        if (!resolved) {
                          setError(t('remoteDirectoryPicker.invalidUri'))
                          return
                        }

                        void loadDirectory(resolved)
                      }}
                      className="remote-directory-picker__entry"
                    >
                      <div className="remote-directory-picker__entry-content">
                        <div className="remote-directory-picker__entry-name">{entry.name}</div>
                        {entry.kind !== 'directory' ? (
                          <div className="remote-directory-picker__entry-note">
                            {t('remoteDirectoryPicker.unknownKindHint')}
                          </div>
                        ) : null}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {!error && technicalDetails.length > 0 && !overview?.canBrowse ? (
            <div className="cove-window__field-help">{technicalDetails[0]}</div>
          ) : null}
        </div>

        <div className="cove-window__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            data-testid="remote-directory-picker-cancel"
            onClick={closePicker}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--primary"
            disabled={isBusy || !canBrowse || currentPath.trim().length === 0}
            data-testid="remote-directory-picker-select"
            onClick={() => {
              onSelect(currentPath)
            }}
          >
            {t('remoteDirectoryPicker.selectAction')}
          </button>
        </div>
      </section>
    </div>
  )
}
