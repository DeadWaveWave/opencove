import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  FileSystemEntry,
  GetEndpointHomeDirectoryResult,
  PrepareWorkerEndpointResult,
  ReadEndpointDirectoryResult,
  RepairWorkerEndpointResult,
  WorkerEndpointOverviewDto,
} from '@shared/contracts/dto'
import { fromFileUri } from '@contexts/filesystem/domain/fileUri'
import { toErrorMessage } from '../utils/format'
import {
  getEndpointActionExecution,
  getEndpointTechnicalDetails,
} from '../utils/endpointOverviewUi'
import { dirname, isAbsolutePath, normalizeSlashes } from '../utils/pathHelpers'
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
  const [overview, setOverview] = useState<WorkerEndpointOverviewDto | null>(null)
  const [currentPath, setCurrentPath] = useState<string>('')
  const [pathInput, setPathInput] = useState('')
  const [entries, setEntries] = useState<FileSystemEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)

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

  const canBrowse = overview?.canBrowse === true
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
      setIsBusy(true)
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
          setIsBusy(false)
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

    try {
      const resolved =
        await window.opencoveApi.controlSurface.invoke<GetEndpointHomeDirectoryResult>({
          kind: 'query',
          id: 'endpoint.homeDirectory',
          payload: { endpointId },
        })
      const home =
        typeof resolved.homeDirectory === 'string' && resolved.homeDirectory.trim().length > 0
          ? resolved.homeDirectory.trim()
          : '/'
      await loadDirectory(home)
    } catch {
      await loadDirectory('/')
    }
  }, [endpointId, initialPath, loadDirectory])

  const handlePrepare = useCallback(
    async (reason: 'connect' | 'browse' | 'reconnect', shouldLoadDirectory: boolean) => {
      setIsBusy(true)
      setError(null)

      try {
        const result = await window.opencoveApi.controlSurface.invoke<PrepareWorkerEndpointResult>({
          kind: 'command',
          id: 'endpoint.prepare',
          payload: { endpointId, reason },
        })
        setOverview(result.overview)
        if (result.overview.canBrowse && shouldLoadDirectory) {
          await loadInitialDirectory()
        }
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      } finally {
        setIsBusy(false)
      }
    },
    [endpointId, loadInitialDirectory],
  )

  const handleRepair = useCallback(
    async (
      action:
        | 'repair_credentials'
        | 'repair_tunnel'
        | 'install_runtime'
        | 'update_runtime'
        | 'retry',
    ) => {
      setIsBusy(true)
      setError(null)

      try {
        const result = await window.opencoveApi.controlSurface.invoke<RepairWorkerEndpointResult>({
          kind: 'command',
          id: 'endpoint.repair',
          payload: { endpointId, action },
        })
        setOverview(result.overview)
        if (result.overview.canBrowse) {
          await loadInitialDirectory()
        }
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      } finally {
        setIsBusy(false)
      }
    },
    [endpointId, loadInitialDirectory],
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
      await handlePrepare(action.reason, true)
      return
    }

    await handleRepair(action.action)
  }, [handlePrepare, handleRepair, overview])

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    requestCounterRef.current += 1
    setOverview(null)
    setError(null)
    setEntries([])
    setCurrentPath('')
    setPathInput('')
    void handlePrepare('browse', true)
  }, [handlePrepare, isOpen])

  if (!isOpen) {
    return null
  }

  return (
    <div
      className="cove-window-backdrop"
      data-testid="remote-directory-picker-backdrop"
      onClick={() => {
        if (isBusy) {
          return
        }

        onCancel()
      }}
      style={{ zIndex: 28 }}
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
          {error ? (
            <p className="cove-window__error" data-testid="remote-directory-picker-error">
              {error}
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
                  void handlePrepare('reconnect', true)
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
            disabled={isBusy}
            data-testid="remote-directory-picker-cancel"
            onClick={() => {
              onCancel()
            }}
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