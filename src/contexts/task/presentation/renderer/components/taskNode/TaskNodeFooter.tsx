import type { JSX, ReactNode } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import { PlayIcon } from '@app/renderer/components/ui/pixelIcons'
import { Button } from '@app/renderer/components/ui/Button'

/** The task card's bottom row: the sessions on the left, the run button on the right. */
export function TaskNodeFooter({
  sessions,
  onRunAgent,
}: {
  sessions: ReactNode
  onRunAgent: () => void
}): JSX.Element {
  const { t } = useTranslation()

  return (
    <div className="task-node__footer nodrag">
      {sessions}

      <Button
        variant="primary"
        size="sm"
        className="task-node__run-agent"
        data-testid="task-node-run-agent"
        onClick={event => {
          event.stopPropagation()
          onRunAgent()
        }}
      >
        <PlayIcon size={12} />
        <span>{t('taskNode.runAgent')}</span>
      </Button>
    </div>
  )
}
