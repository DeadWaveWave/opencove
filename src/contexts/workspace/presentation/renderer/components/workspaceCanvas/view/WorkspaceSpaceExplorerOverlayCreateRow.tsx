import React from 'react'
import { FileText, Folder } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import type { SpaceExplorerCreateMode } from './WorkspaceSpaceExplorerOverlay.model'

export function WorkspaceSpaceExplorerOverlayCreateRow({
  mode,
  rootUri,
  targetDirectoryUri,
  depth,
  draftName,
  error,
  isCreating,
  inputRef,
  onDraftChange,
  onSubmit,
  onCancel,
}: {
  mode: Exclude<SpaceExplorerCreateMode, null>
  rootUri: string
  targetDirectoryUri: string | null
  depth: number
  draftName: string
  error: string | null
  isCreating: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onDraftChange: (value: string) => void
  onSubmit: () => Promise<void>
  onCancel: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const placeholder =
    mode === 'directory'
      ? t('spaceExplorer.folderNamePlaceholder')
      : t('spaceExplorer.fileNamePlaceholder')

  return (
    <form
      key={`create-${targetDirectoryUri ?? rootUri}-${mode}`}
      className="workspace-space-explorer__create"
      style={{ paddingLeft: `${10 + depth * 14}px` }}
      onSubmit={event => {
        event.preventDefault()
        event.stopPropagation()
        void onSubmit()
      }}
      onBlur={event => {
        if (
          isCreating ||
          (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget))
        ) {
          return
        }

        onCancel()
      }}
    >
      <span className="workspace-space-explorer__entry-disclosure-placeholder" aria-hidden="true" />
      {mode === 'directory' ? (
        <Folder className="workspace-space-explorer__entry-icon" aria-hidden="true" />
      ) : (
        <FileText className="workspace-space-explorer__entry-icon" aria-hidden="true" />
      )}
      <input
        ref={inputRef}
        className="workspace-space-explorer__create-input"
        data-testid="workspace-space-explorer-create-input"
        value={draftName}
        placeholder={placeholder}
        aria-label={placeholder}
        disabled={isCreating}
        onChange={event => {
          onDraftChange(event.target.value)
        }}
        onKeyDown={event => {
          if (event.key !== 'Escape') {
            return
          }

          event.preventDefault()
          event.stopPropagation()
          if (!isCreating) {
            onCancel()
          }
        }}
      />
      {error ? (
        <div className="workspace-space-explorer__create-error" role="status">
          {error}
        </div>
      ) : null}
    </form>
  )
}
