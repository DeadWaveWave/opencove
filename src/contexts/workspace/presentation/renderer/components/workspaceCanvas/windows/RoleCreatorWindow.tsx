import React from 'react'
import { TextAreaField, TextField } from '@app/renderer/components/ui/TextField'
import { useTranslation } from '@app/renderer/i18n'
import type { RoleCreatorState } from '../types'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { WindowHeading } from '@app/renderer/components/WindowHeading'
import { UserIcon } from '@app/renderer/components/ui/pixelIcons'

interface RoleCreatorWindowProps {
  roleCreator: RoleCreatorState | null
  update: (recipe: (current: RoleCreatorState) => RoleCreatorState) => void
  closeRoleCreator: () => void
  createRole: () => void
}

export function RoleCreatorWindow({
  roleCreator,
  update,
  closeRoleCreator,
  createRole,
}: RoleCreatorWindowProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const nameRef = React.useRef<HTMLInputElement | null>(null)

  if (!roleCreator) {
    return null
  }

  const isDisabled = roleCreator.isCreating

  return (
    <Dialog
      open
      backdropClassName="cove-window-backdrop workspace-role-creator-backdrop"
      className="cove-window workspace-role-creator"
      data-testid="workspace-role-creator"
      aria-label={roleCreator.mode === 'edit' ? t('roleCreator.editTitle') : t('roleCreator.title')}
      initialFocusRef={nameRef}
      dismissOnEscape={!isDisabled}
      dismissOnPointerDownOutside={!isDisabled}
      onDismiss={closeRoleCreator}
    >
      <WindowHeading
        title={roleCreator.mode === 'edit' ? t('roleCreator.editTitle') : t('roleCreator.title')}
        icon={<UserIcon size={18} />}
        onClose={closeRoleCreator}
        disabled={isDisabled}
      />

      <div className="cove-window__fields">
        <TextField
          label={t('roleCreator.name')}
          ref={nameRef}
          id="workspace-role-name"
          data-testid="workspace-role-name-input"
          value={roleCreator.name}
          disabled={isDisabled}
          placeholder={t('roleCreator.namePlaceholder')}
          onChange={event => {
            const name = event.target.value
            update(current => ({ ...current, name, error: null }))
          }}
        />

        <TextAreaField
          label={t('roleCreator.description')}
          id="workspace-role-description"
          data-testid="workspace-role-description-input"
          value={roleCreator.description}
          disabled={isDisabled}
          placeholder={t('roleCreator.descriptionPlaceholder')}
          onChange={event => {
            const description = event.target.value
            update(current => ({ ...current, description, error: null }))
          }}
        />

        <TextAreaField
          label={t('roleCreator.promptTemplate')}
          id="workspace-role-prompt"
          data-testid="workspace-role-prompt-input"
          value={roleCreator.promptTemplate}
          disabled={isDisabled}
          placeholder={t('roleCreator.promptTemplatePlaceholder')}
          onChange={event => {
            const promptTemplate = event.target.value
            update(current => ({ ...current, promptTemplate, error: null }))
          }}
        />

        <TextField
          label={t('roleCreator.inputHint')}
          id="workspace-role-input-hint"
          data-testid="workspace-role-input-hint-input"
          value={roleCreator.inputHint}
          disabled={isDisabled}
          placeholder={t('roleCreator.inputHintPlaceholder')}
          onChange={event => {
            const inputHint = event.target.value
            update(current => ({ ...current, inputHint, error: null }))
          }}
        />

        <TextField
          label={t('roleCreator.outputFormat')}
          id="workspace-role-output-format"
          data-testid="workspace-role-output-format-input"
          value={roleCreator.outputFormat}
          disabled={isDisabled}
          placeholder={t('roleCreator.outputFormatPlaceholder')}
          onChange={event => {
            const outputFormat = event.target.value
            update(current => ({ ...current, outputFormat, error: null }))
          }}
        />
      </div>

      {roleCreator.error ? <p className="cove-window__error">{roleCreator.error}</p> : null}

      <div className="cove-window__actions">
        <button
          type="button"
          className="cove-window__action cove-window__action--ghost"
          disabled={isDisabled}
          onClick={closeRoleCreator}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="cove-window__action cove-window__action--primary"
          data-testid="workspace-role-create"
          disabled={isDisabled}
          onClick={createRole}
        >
          {isDisabled
            ? roleCreator.mode === 'edit'
              ? t('common.saving')
              : t('common.creating')
            : roleCreator.mode === 'edit'
              ? t('common.save')
              : t('common.create')}
        </button>
      </div>
    </Dialog>
  )
}
