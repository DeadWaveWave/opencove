import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import {
  createLineageAgent,
  establishLineageAgentReady,
  grantedAgentCli,
} from './cli.agent-lineage.helpers'
import {
  taskNotesApp,
  projectId,
  taskId,
  noteId,
  getNode,
  persistedNodes,
  focusNode,
  successfulJson,
} from './cli.task-notes.helpers'

test('a granted agent claims, records work and releases for review across restart', async () => {
  test.setTimeout(180_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-task-workflow-'))
  let app: ElectronApplication | undefined
  try {
    const launched = await taskNotesApp(root)
    app = launched.electronApp
    let page = launched.window
    const agent = (await createLineageAgent(page, projectId)).node
    await establishLineageAgentReady(page, agent)
    const history = (await persistedNodes(page)).find(n => n.id === taskId)!.task!.agentSessions
    expect(history).toHaveLength(1)
    successfulJson(await grantedAgentCli(root, agent.id, ['task', 'claim', '--task', taskId]))
    await focusNode(page, taskId)
    const card = page.locator(`[data-id="${taskId}"] .task-node`)
    await expect(card.getByTestId('task-node-status-select')).toHaveValue('doing')
    await expect(card.getByTestId(`task-node-agent-session-linked-${agent.id}`)).toHaveAttribute(
      'aria-label',
      /Coordinator/,
    )
    expect((await getNode(page, agent.id)).node.data).toMatchObject({ taskId })
    expect((await getNode(page, taskId)).node.data).toMatchObject({ linkedAgentNodeId: agent.id })
    const held = (await persistedNodes(page)).find(n => n.id === taskId)!.task!
    const result = 'Reviewed boundary behavior; result recorded by the task holder.'
    successfulJson(
      await grantedAgentCli(root, agent.id, ['note', 'append', '--node', noteId, '--text', result]),
    )
    expect((await getNode(page, noteId)).node.data).toMatchObject({ text: result })
    successfulJson(
      await grantedAgentCli(root, agent.id, [
        'task',
        'release',
        '--task',
        taskId,
        '--status',
        'ai_done',
      ]),
    )
    await expect(card.getByTestId('task-node-status-select')).toHaveValue('ai_done')
    await expect(card.getByTestId(`task-node-agent-session-linked-${agent.id}`)).toHaveCount(0)
    const nodes = await persistedNodes(page)
    expect(nodes.find(n => n.id === taskId)?.task).toMatchObject({
      status: 'ai_done',
      linkedAgentNodeId: null,
      lastRunAt: held.lastRunAt,
      agentSessions: history,
    })
    expect(nodes.find(n => n.id === agent.id)?.agent).toMatchObject({ taskId: null })
    expect((await getNode(page, agent.id)).node.sessionId).toBe(agent.sessionId)
    await test
      .info()
      .attach('released-task-card', { body: await card.screenshot(), contentType: 'image/png' })
    await app.close()
    app = undefined
    const restarted = await launchApp(launched.options)
    app = restarted.electronApp
    page = restarted.window
    await focusNode(page, taskId)
    await expect(
      page.locator(`[data-id="${taskId}"]`).getByTestId('task-node-status-select'),
    ).toHaveValue('ai_done')
    expect((await getNode(page, taskId)).node.data).toMatchObject({
      linkedAgentNodeId: null,
      status: 'ai_done',
    })
    expect((await getNode(page, agent.id)).node.data).toMatchObject({ taskId: null })
    const restored = (await persistedNodes(page)).find(n => n.id === taskId)?.task
    expect(restored).toMatchObject({ agentSessions: history, lastRunAt: held.lastRunAt })
    await focusNode(page, noteId)
    await expect(
      page.locator(`[data-id="${noteId}"]`).getByTestId('note-node-textarea'),
    ).toHaveValue(result)
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
