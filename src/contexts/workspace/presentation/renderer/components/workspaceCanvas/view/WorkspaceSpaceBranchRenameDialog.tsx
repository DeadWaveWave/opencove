import React from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from '@app/renderer/i18n'

export interface BranchRenameState {
  spaceId: string
  spaceName: string
  worktreePath: string
  targetMountId: string | null
  currentName: string
  nextName: string
  isSubmitting: boolean
  error: string | null
}

export function WorkspaceSpaceBranchRenameDialog({
  branchRename,
  branchRenameInputRef,
  setBranchRename,
  closeBranchRename,
  submitBranchRename,
}: {
  branchRename: BranchRenameState | null
  branchRenameInputRef: React.RefObject<HTMLInputElement | null>
  setBranchRename: React.Dispatch<React.SetStateAction<BranchRenameState | null>>
  closeBranchRename: () => void
  submitBranchRename: () => Promise<void>
}): React.JSX.Element | null {
  const { t } = useTranslation()

  if (!branchRename || !document.body) {
    return null
  }

  return createPortal(
    <div
      className="cove-window-backdrop workspace-space-branch-rename-backdrop"
      data-testid="workspace-space-branch-rename-dialog"
      onClick={() => {
        closeBranchRename()
      }}
    >
      <section
        className="cove-window workspace-space-branch-rename"
        onClick={event => {
          event.stopPropagation()
        }}
      >
        <header className="workspace-space-branch-rename__header">
          <h3>{t('branchRenameDialog.title')}</h3>
          <p className="workspace-space-branch-rename__meta">{branchRename.spaceName}</p>
        </header>

        <div className="cove-window__field-row">
          <label htmlFor="workspace-space-branch-rename-input">
            {t('branchRenameDialog.fieldLabel')}
          </label>
          <input
            id="workspace-space-branch-rename-input"
            ref={branchRenameInputRef}
            data-testid="workspace-space-branch-rename-input"
            value={branchRename.nextName}
            disabled={branchRename.isSubmitting}
            onChange={event => {
              setBranchRename(previous =>
                previous
                  ? {
                      ...previous,
                      nextName: event.target.value,
                      error: null,
                    }
                  : previous,
              )
            }}
            onKeyDown={event => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void submitBranchRename()
              }
            }}
          />
        </div>

        <p className="workspace-space-branch-rename__prompt">{t('branchRenameDialog.prompt')}</p>

        {branchRename.error ? (
          <p className="cove-window__error workspace-space-branch-rename__error">
            {branchRename.error}
          </p>
        ) : null}

        <div className="cove-window__actions workspace-space-branch-rename__actions">
          <button
            type="button"
            className="cove-window__action cove-window__action--ghost"
            data-testid="workspace-space-branch-rename-cancel"
            disabled={branchRename.isSubmitting}
            onClick={() => {
              closeBranchRename()
            }}
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="cove-window__action cove-window__action--primary"
            data-testid="workspace-space-branch-rename-submit"
            disabled={branchRename.isSubmitting}
            onClick={() => {
              void submitBranchRename()
            }}
          >
            {branchRename.isSubmitting
              ? t('branchRenameDialog.renaming')
              : t('branchRenameDialog.confirmRename')}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  )
}
