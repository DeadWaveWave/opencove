import React, { type JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { TaskRuntimeStatus } from '@contexts/workspace/presentation/renderer/types'
import { getTaskStatusLabel } from '@app/renderer/i18n/labels'

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
      <select
        data-testid="task-node-status-select"
        value={status}
        onChange={event => {
          onStatusChange(event.target.value as TaskRuntimeStatus)
        }}
      >
        {taskStatusOptions.map(option => (
          <option value={option} key={option}>
            {getTaskStatusLabel(t, option)}
          </option>
        ))}
      </select>

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
