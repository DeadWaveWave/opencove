import type { JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { TaskRuntimeStatus } from '@contexts/workspace/presentation/renderer/types'
import { getTaskStatusLabel } from '@app/renderer/i18n/labels'
import { CoveSelect } from '@app/renderer/components/CoveSelect'

export function TaskNodeFooter({
  status,
  onStatusChange,
  onRunAgent,
}: {
  status: TaskRuntimeStatus
  onStatusChange: (status: TaskRuntimeStatus) => void
  onRunAgent: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const taskStatusOptions: TaskRuntimeStatus[] = ['todo', 'doing', 'ai_done', 'done']

  return (
    <div className="task-node__footer nodrag">
      <CoveSelect
        testId="task-node-status-select"
        triggerTestId="task-node-status-select-trigger"
        className="task-node__footer-select"
        size="compact"
        value={status}
        options={taskStatusOptions.map(option => ({
          value: option,
          label: getTaskStatusLabel(t, option),
        }))}
        onChange={nextValue => {
          onStatusChange(nextValue as TaskRuntimeStatus)
        }}
      />

      <button
        type="button"
        className="task-node__run-agent"
        data-testid="task-node-run-agent"
        onClick={event => {
          event.stopPropagation()
          onRunAgent()
        }}
      >
        {t('taskNode.runAgent')}
      </button>
    </div>
  )
}
