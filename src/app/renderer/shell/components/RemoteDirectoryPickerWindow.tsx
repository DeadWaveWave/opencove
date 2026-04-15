import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  FileSystemEntry,
  GetEndpointHomeDirectoryResult,
  ReadEndpointDirectoryResult,
} from '@shared/contracts/dto'
import { fromFileUri } from '@contexts/filesystem/domain/fileUri'
import { toErrorMessage } from '../utils/format'
import { dirname, isAbsolutePath, normalizeSlashes } from '../utils/pathHelpers'

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

  const loadDirectory = useCallback(
    async (path: string) => {
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

  useLayoutEffect(() => {
    if (!isOpen) {
      return
    }

    const initialRequestGuard = (requestCounterRef.current += 1)
    setError(null)
    setEntries([])
    setCurrentPath('')
    setPathInput('')

    void (async () => {
      const preferred = normalizeSlashes((initialPath ?? '').trim())
      if (preferred.length > 0 && isAbsolutePath(preferred)) {
        if (requestCounterRef.current !== initialRequestGuard) {
          return
        }
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
        if (requestCounterRef.current !== initialRequestGuard) {
          return
        }
        const home =
          typeof resolved.homeDirectory === 'string' && resolved.homeDirectory.trim().length > 0
            ? resolved.homeDirectory.trim()
            : '/'
        await loadDirectory(home)
      } catch {
        if (requestCounterRef.current !== initialRequestGuard) {
          return
        }
        await loadDirectory('/')
      }
    })()
  }, [endpointId, initialPath, isOpen, loadDirectory])

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
        className="cove-window"
        data-testid="remote-directory-picker-window"
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(720px, calc(100vw - 48px))' }}
      >
        <h3>{t('remoteDirectoryPicker.title')}</h3>
        <p>{t('remoteDirectoryPicker.description', { endpoint: endpointLabel })}</p>

        <div className="cove-window__fields">
          {error ? (
            <p className="cove-window__error" data-testid="remote-directory-picker-error">
              {error}
            </p>
          ) : null}

          <div className="cove-window__field-row">
            <label htmlFor="remote-directory-picker-path">
              {t('remoteDirectoryPicker.pathLabel')}
            </label>
            <div style={{ display: 'flex', gap: 10, width: '100%', alignItems: 'center' }}>
              <input
                id="remote-directory-picker-path"
                className="cove-field"
                type="text"
                ref={pathInputElementRef}
                value={pathInput}
                disabled={isBusy}
                placeholder={t('remoteDirectoryPicker.pathPlaceholder')}
                data-testid="remote-directory-picker-path"
                style={{ flex: 1 }}
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
                disabled={isBusy || !parentPath}
                data-testid="remote-directory-picker-up"
                style={{ flexShrink: 0 }}
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
                disabled={isBusy || refreshCandidate.trim().length === 0}
                data-testid="remote-directory-picker-refresh"
                style={{ flexShrink: 0 }}
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

          <div className="cove-window__field-row">
            <label>{t('remoteDirectoryPicker.foldersLabel')}</label>
            <div
              style={{
                border: '1px solid var(--cove-border-subtle)',
                borderRadius: 14,
                background: 'var(--cove-window-surface)',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  maxHeight: 340,
                  overflow: 'auto',
                }}
              >
                {entries.length === 0 ? (
                  <div
                    style={{
                      padding: '12px 12px',
                      color: 'var(--cove-text-faint)',
                      fontSize: 12,
                    }}
                    data-testid="remote-directory-picker-empty"
                  >
                    {isBusy ? t('common.loading') : t('remoteDirectoryPicker.empty')}
                  </div>
                ) : (
                  entries.map((entry, index) => (
                    <button
                      key={entry.uri}
                      type="button"
                      disabled={isBusy}
                      data-testid={`remote-directory-picker-entry-${String(index)}`}
                      onClick={() => {
                        const resolved = fromFileUri(entry.uri)
                        if (!resolved) {
                          setError(t('remoteDirectoryPicker.invalidUri'))
                          return
                        }

                        void loadDirectory(resolved)
                      }}
                      style={{
                        width: '100%',
                        textAlign: 'left',
                        border: 0,
                        borderBottom: '1px solid var(--cove-border-subtle)',
                        background: 'transparent',
                        color: 'var(--cove-text)',
                        padding: '10px 12px',
                        cursor: isBusy ? 'not-allowed' : 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</div>
                        {entry.kind !== 'directory' ? (
                          <div style={{ fontSize: 11, color: 'var(--cove-text-faint)' }}>
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
            disabled={isBusy || currentPath.trim().length === 0}
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
