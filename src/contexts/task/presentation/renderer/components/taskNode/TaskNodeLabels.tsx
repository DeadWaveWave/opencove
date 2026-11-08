import type { JSX, ReactNode } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { getTaskPriorityLabel } from '@app/renderer/i18n/labels'
import { FlagIcon } from '@app/renderer/components/ui/pixelIcons'
import type { TaskPriority } from '@contexts/workspace/presentation/renderer/types'

/**
 * The task card's labels: the priority under its pixel flag, then the tags, as many as fit on the
 * line. `children` ends the row (the live card's edit button).
 */
export function TaskNodeLabels({
  priority,
  tags,
  children,
}: {
  priority: TaskPriority
  tags: string[]
  children?: ReactNode
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="task-node__labels">
      <span
        className={`task-node__priority task-node__priority--${priority}`}
        data-testid="task-node-priority"
      >
        <FlagIcon size={12} className="task-node__priority-flag" />
        <span>{getTaskPriorityLabel(t, priority).toUpperCase()}</span>
      </span>

      <span className="task-node__tags" data-testid="task-node-tags">
        {tags.length > 0 ? (
          tags.map(tag => (
            <span key={tag} className="task-node__tag">
              #{tag}
            </span>
          ))
        ) : (
          <span className="task-node__tag task-node__tag--empty">{t('taskNode.noTags')}</span>
        )}
      </span>
      {children}
    </div>
  )
}
