import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { Dialog } from '@app/renderer/components/ui/Dialog'
import { Button } from '@app/renderer/components/ui/Button'
import type { TaskAgentSessionRecord } from '@contexts/workspace/presentation/renderer/types'

/** Confirms resuming a past session, warning when its bound directory is not the task's. */
export function TaskNodeResumeDialog({
  record,
  currentDirectory,
  onCancel,
  onResume,
}: {
  record: TaskAgentSessionRecord
  currentDirectory: string
  onCancel: () => void
  onResume: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const isDirectoryMismatch = record.boundDirectory !== currentDirectory

  return (
    <Dialog
      open
      backdropClassName="cove-window-backdrop task-agent-resume-backdrop"
      backdropTestId="task-node-agent-session-resume-confirm"
      className="cove-window task-agent-resume"
      aria-label={t('taskNode.resumeDialog.title')}
      onDismiss={onCancel}
    >
      <h3>{t('taskNode.resumeDialog.title')}</h3>
      <p className="cove-window__meta">{t('taskNode.resumeDialog.description')}</p>

      <div className="cove-window__field-row">
        <label>{t('taskNode.resumeDialog.boundDirectory')}</label>
        <input value={record.boundDirectory} disabled />
      </div>

      <div className="cove-window__field-row">
        <label>{t('taskNode.resumeDialog.currentDirectory')}</label>
        <input value={currentDirectory} disabled />
      </div>

      {isDirectoryMismatch ? (
        <p className="cove-window__error">{t('taskNode.resumeDialog.mismatch')}</p>
      ) : (
        <p className="cove-window__meta">{t('taskNode.resumeDialog.aligned')}</p>
      )}

      <div className="cove-window__actions">
        <Button variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
        <Button
          variant={isDirectoryMismatch ? 'danger' : 'primary'}
          data-testid={`task-node-agent-session-resume-confirm-resume-${record.id}`}
          onClick={onResume}
        >
          {t('taskNode.resume')}
        </Button>
      </div>
    </Dialog>
  )
}
