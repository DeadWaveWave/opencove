import { useId, type JSX } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { getTaskStatusLabel } from '@app/renderer/i18n/labels'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { SegmentedControl } from '@app/renderer/components/ui/SegmentedControl'
import type { TaskRuntimeStatus } from '@contexts/workspace/presentation/renderer/types'

/** A task's statuses in the order it moves through them. */
const TASK_STATUS_STEPS: readonly TaskRuntimeStatus[] = ['todo', 'doing', 'ai_done', 'done']

/**
 * The task card's progress bar: one step per status, filled up to the current one. The steps are
 * a segmented control, so clicking a step, or arrowing to it, moves the task there. The status
 * menu beside it names the current status and offers the same choice as a list.
 */
export function TaskNodeStatusSteps({
  status,
  onStatusChange,
}: {
  status: TaskRuntimeStatus
  onStatusChange: (status: TaskRuntimeStatus) => void
}): JSX.Element {
  const { t } = useTranslation()
  const labelId = useId()
  const current = Math.max(0, TASK_STATUS_STEPS.indexOf(status))

  return (
    // Clicks stay in the row. Arrow keys on a step fire a click too; reaching the canvas it would
    // select the window, and the selection box would take focus, so the next arrow would nudge
    // the window instead of moving the status.
    <div
      className="task-node__progress"
      onClick={event => {
        event.stopPropagation()
      }}
    >
      <SegmentedControl
        className="task-node__steps nodrag"
        label={t('taskNode.status')}
        value={status}
        options={TASK_STATUS_STEPS.map((step, index) => ({
          value: step,
          label: getTaskStatusLabel(t, step),
          iconOnly: true,
          icon: (
            <span className="task-node__step" data-filled={index <= current ? 'true' : 'false'} />
          ),
          testId: `task-node-status-step-${step}`,
        }))}
        onValueChange={onStatusChange}
      />

      {/* Names the status menu as "Task status, <status>" (CoveSelect adds the value). */}
      <span id={labelId} hidden>
        {t('taskNode.status')}
      </span>
      <CoveSelect
        testId="task-node-status-select"
        triggerTestId="task-node-status-select-trigger"
        className="task-node__status-select nodrag"
        triggerClassName="task-node__status-trigger"
        size="compact"
        aria-labelledby={labelId}
        value={status}
        options={TASK_STATUS_STEPS.map(option => ({
          value: option,
          label: getTaskStatusLabel(t, option),
        }))}
        onChange={nextValue => {
          onStatusChange(nextValue as TaskRuntimeStatus)
        }}
      />
    </div>
  )
}

/** The same progress to read only (the space archive's replay): the steps and the status's name. */
export function TaskNodeStatusReadout({ status }: { status: TaskRuntimeStatus }): JSX.Element {
  const { t } = useTranslation()
  const current = Math.max(0, TASK_STATUS_STEPS.indexOf(status))
  const label = getTaskStatusLabel(t, status)

  return (
    <div
      className="task-node__progress"
      role="img"
      aria-label={`${t('taskNode.status')}: ${label}`}
    >
      <span className="task-node__steps task-node__steps--readout" aria-hidden="true">
        {TASK_STATUS_STEPS.map((step, index) => (
          <span
            key={step}
            className="task-node__step"
            data-filled={index <= current ? 'true' : 'false'}
          />
        ))}
      </span>
      <span className="task-node__status-name" aria-hidden="true">
        {label}
      </span>
    </div>
  )
}
