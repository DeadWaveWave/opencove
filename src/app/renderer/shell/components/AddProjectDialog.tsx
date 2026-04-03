import React, { useCallback, useMemo, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { WorkspaceDirectory } from '@shared/contracts/dto'
import { toFileUri } from '@contexts/filesystem/domain/fileUri'
import { invokeBrowserControlSurface } from '@app/renderer/browser/browserControlSurface'
import { toErrorMessage } from '../utils/format'

function isAbsolutePath(pathValue: string): boolean {
  return /^([a-zA-Z]:[\\/]|\/)/.test(pathValue)
}

function basename(pathValue: string): string {
  const normalized = pathValue.replace(/[\\/]+$/, '')
  const parts = normalized.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? normalized
}

function randomId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

export function AddProjectDialog({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void
  onConfirm: (directory: WorkspaceDirectory) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [projectPath, setProjectPath] = useState('')
  const [projectName, setProjectName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const derivedName = useMemo(() => {
    const trimmed = projectName.trim()
    if (trimmed.length > 0) {
      return trimmed
    }

    const pathValue = projectPath.trim()
    return pathValue.length > 0 ? basename(pathValue) : ''
  }, [projectName, projectPath])

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) {
      return
    }

    const trimmedPath = projectPath.trim()
    if (trimmedPath.length === 0) {
      setError(t('addProjectDialog.pathRequired'))
      return
    }

    if (!isAbsolutePath(trimmedPath)) {
      setError(t('addProjectDialog.pathMustBeAbsolute'))
      return
    }

    setIsSubmitting(true)
    setError(null)

    try {
      await invokeBrowserControlSurface<void>({
        kind: 'command',
        id: 'workspace.approveRoot',
        payload: { path: trimmedPath },
      })

      const stat = await window.opencoveApi.filesystem.stat({ uri: toFileUri(trimmedPath) })
      if (stat.kind !== 'directory') {
        setError(t('addProjectDialog.pathMustBeDirectory'))
        return
      }

      const name = derivedName.trim()
      if (name.length === 0) {
        setError(t('addProjectDialog.nameRequired'))
        return
      }

      onConfirm({
        id: randomId(),
        name,
        path: trimmedPath,
      })
    } catch (submitError) {
      setError(t('addProjectDialog.failed', { message: toErrorMessage(submitError) }))
    } finally {
      setIsSubmitting(false)
    }
  }, [derivedName, isSubmitting, onConfirm, projectPath, t])

  return (
    <div
      className="cove-window-backdrop workspace-task-creator-backdrop"
      data-testid="workspace-project-add-backdrop"
      onClick={() => {
        if (isSubmitting) {
          return
        }

        onCancel()
      }}
    >
      <section
        className="cove-window workspace-task-creator"
        data-testid="workspace-project-add-dialog"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <h3>{t('addProjectDialog.title')}</h3>
        <p>{t('addProjectDialog.description')}</p>

        <div className="cove-window__fields">
          <div className="cove-window__field-row">
            <label htmlFor="workspace-project-add-path">{t('addProjectDialog.pathLabel')}</label>
            <input
              id="workspace-project-add-path"
              data-testid="workspace-project-add-path"
              value={projectPath}
              disabled={isSubmitting}
              placeholder={t('addProjectDialog.pathPlaceholder')}
              onChange={event => {
                setProjectPath(event.target.value)
              }}
            />
          </div>

          <div className="cove-window__field-row">
            <label htmlFor="workspace-project-add-name">{t('addProjectDialog.nameLabel')}</label>
            <input
              id="workspace-project-add-name"
              data-testid="workspace-project-add-name"
              value={projectName}
              disabled={isSubmitting}
              placeholder={t('addProjectDialog.namePlaceholder')}
              onChange={event => {
                setProjectName(event.target.value)
              }}
            />
          </div>

          {error ? (
            <p className="workspace-task-creator__error" data-testid="workspace-project-add-error">
              {error}
            </p>
          ) : null}
        </div>

        <div className="cove-window__actions workspace-task-creator__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost workspace-task-creator__action workspace-task-creator__action--ghost"
            data-testid="workspace-project-add-cancel"
            disabled={isSubmitting}
            onClick={() => {
              onCancel()
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--primary workspace-task-creator__action workspace-task-creator__action--primary"
            data-testid="workspace-project-add-confirm"
            disabled={isSubmitting}
            onClick={() => {
              void handleSubmit()
            }}
          >
            {isSubmitting ? t('common.loading') : t('common.add')}
          </button>
        </div>
      </section>
    </div>
  )
}
