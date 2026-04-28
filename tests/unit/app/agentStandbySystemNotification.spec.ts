import { describe, expect, it } from 'vitest'
import { formatAgentStandbySystemNotification } from '../../../src/app/renderer/shell/hooks/useAgentStandbyNotifications'

describe('formatAgentStandbySystemNotification', () => {
  it('formats native agent completion notification context', () => {
    const notification = formatAgentStandbySystemNotification(
      {
        title: 'Codex',
        workspaceName: 'OpenCove',
        taskTitle: 'Fix session watcher',
        spaceName: 'Agent Runtime',
      },
      {
        standby: 'Standby',
        task: 'Tasks',
        space: 'Spaces',
      },
    )

    expect(notification).toEqual({
      title: 'Codex',
      body: ['Standby · OpenCove', 'Tasks: Fix session watcher', 'Spaces: Agent Runtime'].join(
        '\n',
      ),
    })
  })
})
