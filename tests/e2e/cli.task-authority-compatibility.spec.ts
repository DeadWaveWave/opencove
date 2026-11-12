import { expect, test } from '@playwright/test'
import { withOutputWorkspace } from './cli.output.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'

// Schema installation must remain independently releasable before task authority activation.
// This covers the review's old-UI compatibility requirement, not active V5 coordination.
test('installing task authority schema preserves note editing and existing task commands', async () => {
  await withOutputWorkspace(
    [
      {
        id: 'compat-note',
        kind: 'note',
        title: 'Notes',
        position: { x: 1000, y: 20 },
        width: 300,
        height: 260,
        task: { text: 'Existing note' },
      },
      {
        id: 'compat-task',
        kind: 'task',
        title: 'Task',
        position: { x: 1400, y: 20 },
        width: 300,
        height: 260,
        task: { requirement: 'Existing task', status: 'todo', priority: 'medium', tags: [] },
      },
    ],
    async (page, shell) => {
      const capabilities = await page.evaluate(async () =>
        window.opencoveApi.controlSurface.invoke<{ features: Record<string, boolean> }>({
          kind: 'query',
          id: 'system.capabilities',
          payload: null,
        }),
      )
      expect(capabilities.features.taskAuthorityV1).not.toBe(true)
      await page.evaluate(async () =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'canvas.focus',
          payload: { target: { kind: 'node', nodeId: 'compat-note' } },
        }),
      )
      const textarea = page.locator('[data-id="compat-note"] [data-testid="note-node-textarea"]')
      await expect(textarea).toBeVisible()
      await textarea.fill('Saved from the existing note editor 🌊')
      await expect
        .poll(async () => {
          const result = await page.evaluate(async () =>
            window.opencoveApi.controlSurface.invoke<{ node: { data: { text: string } } }>({
              kind: 'query',
              id: 'node.get',
              payload: { nodeId: 'compat-note' },
            }),
          )
          return result.node.data.text
        })
        .toBe('Saved from the existing note editor 🌊')
      const updated = jsonOutput(
        await terminalCommand(
          page,
          shell,
          'opencove node update task --node compat-task --status done',
          'TASK_STATUS',
        ),
      )
      expect(updated.node).toMatchObject({ id: 'compat-task', data: { status: 'done' } })
      const note = jsonOutput(
        await terminalCommand(
          page,
          shell,
          'opencove node get --node compat-note --fields data.text',
          'NOTE_READ',
        ),
      )
      expect(note).toEqual({ node: { data: { text: 'Saved from the existing note editor 🌊' } } })
      await page.reload()
      await expect
        .poll(async () =>
          page.evaluate(async () => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              node: { data: { text: string } }
            }>({
              kind: 'query',
              id: 'node.get',
              payload: { nodeId: 'compat-note' },
            })
            return result.node.data.text
          }),
        )
        .toBe('Saved from the existing note editor 🌊')
      const task = await page.evaluate(async () =>
        window.opencoveApi.controlSurface.invoke<{ node: { data: { status: string } } }>({
          kind: 'query',
          id: 'node.get',
          payload: { nodeId: 'compat-task' },
        }),
      )
      expect(task.node.data.status).toBe('done')
    },
  )
})
