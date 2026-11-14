import { expect, test } from '@playwright/test'
import { boundedWorkspace, invoke, projectId } from './cli.bounded-agent-spawning.helpers'
import type {
  CanvasNodeDetailDto,
  GetNodeResult,
  ListNodesResult,
} from '../../src/shared/contracts/dto/nodeControl'
import { establishLineageAgentReady } from './cli.agent-lineage.helpers'

import { fillMixedTree, recoveredDescendants } from '../support/boundedSpawning'
import { findEmptyPanePoint } from './workspace-canvas.pane.helpers'

test('actual UI launch and Run Role create independent roots with usable grants', async () => {
  test.setTimeout(360_000)
  await boundedWorkspace(async f => {
    const page = f.page()
    // Create the role through the same form as a user, then click its Run button.
    const pane = page.locator('.workspace-canvas .react-flow__pane').first()
    await pane.click({ button: 'right', position: await findEmptyPanePoint(pane) })
    await page.getByTestId('workspace-context-run-role').click()
    await page.getByTestId('workspace-context-new-role').click()
    await page.getByTestId('workspace-role-name-input').fill('Reviewer')
    await page.getByTestId('workspace-role-description-input').fill('Review this project')
    await page.getByTestId('workspace-role-prompt-input').fill('Review this project carefully')
    await page.getByTestId('workspace-role-input-hint-input').fill('Review request')
    await page.getByTestId('workspace-role-output-format-input').fill('Findings')
    await page.getByTestId('workspace-role-create').click()
    await expect(page.locator('.role-node')).toHaveCount(1)
    const old = new Set(
      (await invoke<ListNodesResult>(page, 'node.list', { projectId }, 'query')).nodes.map(
        n => n.id,
      ),
    )
    await page.getByTestId('role-node-run').click()
    let agentId = ''
    await expect
      .poll(
        async () => {
          agentId =
            (await invoke<ListNodesResult>(page, 'node.list', { projectId }, 'query')).nodes.find(
              n => n.kind === 'agent' && !old.has(n.id),
            )?.id ?? ''
          return agentId
        },
        { timeout: 30_000 },
      )
      .not.toBe('')
    const agent = (await invoke<GetNodeResult>(page, 'node.get', { nodeId: agentId }, 'query')).node
    await establishLineageAgentReady(page, agent)
    const who = await f.command(agent, ['whoami'])
    expect(who.code, who.stderr).toBe(0)
    expect(JSON.parse(who.stdout)).toMatchObject({ nodeId: agent.id, sessionId: agent.sessionId })
    const child = await f.child(agent)
    expect(child).toMatchObject({ spawnedBy: agent.id, lineageDepth: 2 })
    await fillMixedTree(f)
    const beforeUserLaunch = new Set(
      (await invoke<ListNodesResult>(f.page(), 'node.list', { projectId }, 'query')).nodes.map(
        n => n.id,
      ),
    )
    await f.page().getByTestId('workspace-canvas-action-bar-new-agent').click()
    let userId = ''
    await expect
      .poll(
        async () => {
          const nodes = (
            await invoke<ListNodesResult>(f.page(), 'node.list', { projectId }, 'query')
          ).nodes
          userId = nodes.find(n => n.kind === 'agent' && !beforeUserLaunch.has(n.id))?.id ?? ''
          return userId
        },
        { timeout: 30_000 },
      )
      .not.toBe('')
    const user = (await invoke<GetNodeResult>(f.page(), 'node.get', { nodeId: userId }, 'query'))
      .node
    expect(user).toMatchObject({ lineageDepth: 1, lineageStatus: 'root', spawnedBy: null })
    await establishLineageAgentReady(f.page(), user)
  })
})

test('Desktop restart projects surviving lineage and live recovered runtimes', async () => {
  test.setTimeout(360_000)
  await boundedWorkspace(async f => {
    const children: CanvasNodeDetailDto[] = []
    for (const kind of recoveredDescendants) {
      children.push(await f.child(f.parent, kind))
    }
    const removed = children.pop()!
    await invoke(f.page(), 'node.delete', { nodeId: removed.id })
    await expect
      .poll(
        async () =>
          (
            await invoke<{ sessions: { sessionId: string; status: string }[] }>(
              f.page(),
              'session.list',
              null,
              'query',
            )
          ).sessions.find(s => s.sessionId === removed.sessionId)?.status,
      )
      .toBe('exited')
    const replacement = await f.child(f.parent, 'terminal')
    await f.restart(children[0])
    for (const child of [...children, replacement]) {
      const node = (
        await invoke<GetNodeResult>(f.page(), 'node.get', { nodeId: child.id }, 'query')
      ).node
      expect(node).toMatchObject({ spawnedBy: f.parent.id, lineageDepth: 2 })
      await invoke(f.page(), 'canvas.focus', { target: { kind: 'node', nodeId: child.id } })
      if (child.kind === 'terminal') {
        await expect
          .poll(
            async () => {
              const recoveredNode = (
                await invoke<GetNodeResult>(f.page(), 'node.get', { nodeId: child.id }, 'query')
              ).node
              const sessions = await invoke<{ sessions: { sessionId: string; status: string }[] }>(
                f.page(),
                'session.list',
                null,
                'query',
              )
              return sessions.sessions.find(s => s.sessionId === recoveredNode.sessionId)?.status
            },
            { timeout: 30_000 },
          )
          .toBe('running')
      }
    }
    // Starting a new user root is the documented recovery path.
    await f.page().getByTestId('workspace-canvas-action-bar-new-agent').click()
  })
})
