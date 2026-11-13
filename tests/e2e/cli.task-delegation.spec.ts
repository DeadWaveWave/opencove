import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removePathWithRetry } from './workspace-canvas.helpers'
import {
  createLineageAgent,
  establishLineageAgentReady,
  grantedAgentCli,
} from './cli.agent-lineage.helpers'
import {
  taskNotesApp,
  projectId,
  taskId,
  getNode,
  focusNode,
  successfulJson,
} from './cli.task-notes.helpers'
import type { CanvasNodeDetailDto } from '../../src/shared/contracts/dto/nodeControl'

test('a coordinator assigns and releases descendant agents while siblings and unrelated agents are refused', async () => {
  test.setTimeout(240_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-task-delegation-'))
  let app: ElectronApplication | undefined
  try {
    const launched = await taskNotesApp(root)
    app = launched.electronApp
    const page = launched.window
    const leader = (await createLineageAgent(page, projectId)).node
    await establishLineageAgentReady(page, leader)
    const spawn = async (parent: CanvasNodeDetailDto, title: string) => {
      const created = successfulJson(
        await grantedAgentCli(root, parent.id, [
          'node',
          'create',
          'agent',
          '--root-canvas',
          '--provider',
          'claude-code',
          '--title',
          title,
        ]),
      )
      const node = created.node as CanvasNodeDetailDto
      expect(node.spawnedBy).toBe(parent.id)
      await establishLineageAgentReady(page, node)
      return node
    }
    const child = await spawn(leader, 'Child')
    const grandchild = await spawn(child, 'Grandchild')
    const sibling = await spawn(leader, 'Sibling')
    const unrelated = (await createLineageAgent(page, projectId)).node
    await establishLineageAgentReady(page, unrelated)
    /* eslint-disable no-await-in-loop -- Assign and release the same task in sequence. */
    for (const agent of [child, grandchild]) {
      // eslint-disable-next-line no-await-in-loop -- One task must be released before the next assignment.
      successfulJson(
        await grantedAgentCli(root, leader.id, [
          'task',
          'claim',
          '--task',
          taskId,
          '--agent',
          agent.id,
        ]),
      )
      // eslint-disable-next-line no-await-in-loop
      await focusNode(page, taskId)
      const card = page.locator(`[data-id="${taskId}"] .task-node`)
      // eslint-disable-next-line no-await-in-loop
      await expect(card.getByTestId('task-node-status-select')).toHaveValue('doing')
      // eslint-disable-next-line no-await-in-loop
      expect((await getNode(page, agent.id)).node.data).toMatchObject({ taskId })
      // eslint-disable-next-line no-await-in-loop
      successfulJson(
        await grantedAgentCli(root, leader.id, [
          'task',
          'release',
          '--task',
          taskId,
          '--status',
          'ai_done',
        ]),
      )
      // eslint-disable-next-line no-await-in-loop
      await expect(card.getByTestId('task-node-status-select')).toHaveValue('ai_done')
      // eslint-disable-next-line no-await-in-loop
      expect((await getNode(page, agent.id)).node.data).toMatchObject({ taskId: null })
    }
    /* eslint-enable no-await-in-loop */
    const siblingClaim = await grantedAgentCli(root, child.id, [
      'task',
      'claim',
      '--task',
      taskId,
      '--agent',
      sibling.id,
      '-o',
      'json',
    ])
    expect(siblingClaim.code).toBe(4)
    expect(siblingClaim.stdout).toBe('')
    expect(JSON.parse(siblingClaim.stderr).error.message).toContain(
      'your own agents or agents you started',
    )
    const unrelatedClaim = await grantedAgentCli(root, leader.id, [
      'task',
      'claim',
      '--task',
      taskId,
      '--agent',
      unrelated.id,
      '-o',
      'json',
    ])
    expect(unrelatedClaim.code).toBe(4)
    expect(unrelatedClaim.stdout).toBe('')
    successfulJson(await grantedAgentCli(root, unrelated.id, ['task', 'claim', '--task', taskId]))
    const unrelatedRelease = await grantedAgentCli(root, leader.id, [
      'task',
      'release',
      '--task',
      taskId,
      '-o',
      'json',
    ])
    expect(unrelatedRelease.code).toBe(4)
    expect(JSON.parse(unrelatedRelease.stderr).error.message).toContain(
      'your own agents or agents you started',
    )
    expect((await getNode(page, taskId)).node.data).toMatchObject({
      linkedAgentNodeId: unrelated.id,
      status: 'doing',
    })
    successfulJson(
      await grantedAgentCli(root, unrelated.id, [
        'task',
        'release',
        '--task',
        taskId,
        '--status',
        'ai_done',
      ]),
    )
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
