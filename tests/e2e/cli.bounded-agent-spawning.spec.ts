import { expect, test } from '@playwright/test'
import {
  boundedWorkspace,
  expectSpawnRefusal,
  invoke,
  projectId,
  runtimeCounts,
  stopAndWait,
} from './cli.bounded-agent-spawning.helpers'
import type {
  CanvasNodeDetailDto,
  GetNodeResult,
  ListNodesResult,
} from '../../src/shared/contracts/dto/nodeControl'
import { establishLineageAgentReady } from './cli.agent-lineage.helpers'

test('depth four refuses both runtime kinds without creating a node or session', async () => {
  test.setTimeout(240_000)
  await boundedWorkspace(async f => {
    const child = await f.child(f.parent),
      grandchild = await f.child(child)
    expect(grandchild.lineageDepth).toBe(3)
    const before = await runtimeCounts(f.page())
    for (const kind of ['agent', 'terminal']) {
      const result = await f.command(grandchild, ['node', 'create', kind, '--root-canvas'])
      const error = expectSpawnRefusal(result, 'agent.spawn_depth_limit', 1)
      expect(error.message).toContain('depth of 3')
      expect(error.hint).toContain('user')
    }
    expect(await runtimeCounts(f.page())).toEqual(before)
  })
})
test('six mixed descendants share a budget, exit frees a slot, and an actual UI launch is exempt', async () => {
  test.setTimeout(360_000)
  await boundedWorkspace(async f => {
    const child = await f.child(f.parent)
    await f.child(child, 'terminal')
    const terminal = await f.child(f.parent, 'terminal')
    for (let i = 0; i < 3; i++) {
      await f.child(f.parent)
    }
    const before = await runtimeCounts(f.page())
    const refusal = expectSpawnRefusal(
      await f.command(f.parent, ['node', 'create', 'agent', '--root-canvas']),
      'agent.spawn_concurrency_limit',
      1,
    )
    expect(refusal.hint).toContain('exit')
    expect(await runtimeCounts(f.page())).toEqual(before)
    await stopAndWait(f.page(), terminal)
    await f.child(f.parent)
    expect(
      (await invoke<GetNodeResult>(f.page(), 'node.get', { nodeId: terminal.id }, 'query')).node.id,
    ).toBe(terminal.id)
    const old = new Set(
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
          userId = nodes.find(n => n.kind === 'agent' && !old.has(n.id))?.id ?? ''
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
test('granted run-agent and generic raw launch are refused with migration guidance', async () => {
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    const before = await runtimeCounts(f.page())
    for (const args of [
      ['session', 'run-agent', '--prompt', 'Help me'],
      [
        'api',
        'call',
        'session.launchAgent',
        '--input',
        JSON.stringify({ cwd: f.workspace, prompt: 'Help me' }),
      ],
    ]) {
      const error = expectSpawnRefusal(await f.command(f.parent, args), 'common.forbidden', 4)
      expect(error.hint).toContain('node create')
    }
    expect(await runtimeCounts(f.page())).toEqual(before)
  })
})
test('deletion releases only after runtime exit and restart preserves lineage and recovered occupancy', async () => {
  test.setTimeout(360_000)
  await boundedWorkspace(async f => {
    const children: CanvasNodeDetailDto[] = []
    for (let i = 0; i < 6; i++) {
      children.push(await f.child(f.parent, i === 0 ? 'agent' : 'terminal'))
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
    }
    // Orphan ancestry cannot prove a deleted historical runtime's owner after restart.
    const refused = await f.command(children[0], ['node', 'create', 'terminal', '--root-canvas'])
    expectSpawnRefusal(refused, 'common.unavailable', 1)
    // Starting a new user root is the documented recovery path.
    await f.page().getByTestId('workspace-canvas-action-bar-new-agent').click()
  })
})

test('a user standalone session keeps non-runtime grants but needs a canvas agent to delegate runtimes', async () => {
  test.setTimeout(180_000)
  await boundedWorkspace(async f => {
    // Use the user's real launch route. The mailbox name is only a fixture filename;
    // OPENCOVE_NODE_ID remains absent and the CLI authenticates its inherited grant.
    const standalone = await invoke<{ sessionId: string }>(f.page(), 'session.launchAgent', {
      workspaceId: projectId,
      cwd: f.workspace,
      provider: 'claude-code',
      prompt: 'Help me review',
    })
    expect(standalone.sessionId).toBeTruthy()
    const mailbox = { id: 'undefined' }
    const who = await f.command(mailbox, ['whoami'])
    expect(who.code, who.stderr).toBe(0)
    expect(JSON.parse(who.stdout)).toMatchObject({ caller: 'session-grant', nodeId: null })
    const note = await f.command(mailbox, [
      'node',
      'create',
      'note',
      '--root-canvas',
      '--project',
      projectId,
      '--text',
      'Findings',
    ])
    expect(note.code, note.stderr).toBe(0)
    const before = await runtimeCounts(f.page())
    for (const kind of ['agent', 'terminal']) {
      const result = await f.command(mailbox, [
        'node',
        'create',
        kind,
        '--root-canvas',
        '--project',
        projectId,
      ])
      const error = expectSpawnRefusal(result, 'common.forbidden', 4)
      expect(error.hint).toContain('canvas')
    }
    expect(await runtimeCounts(f.page())).toEqual(before)
  })
})

test('real Run Role launches a root whose inherited grant can create a child', async () => {
  test.setTimeout(240_000)
  await boundedWorkspace(async f => {
    const page = f.page()
    // Create the role through the same form as a user, then click its Run button.
    await page
      .locator('.workspace-canvas .react-flow__pane')
      .first()
      .click({ button: 'right', position: { x: 150, y: 150 } })
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
  })
})

test('restart counts recovered live descendants rather than saved session IDs', async () => {
  test.setTimeout(360_000)
  await boundedWorkspace(async f => {
    const child = await f.child(f.parent)
    const terminals: CanvasNodeDetailDto[] = []
    for (let i = 0; i < 5; i++) {
      terminals.push(await f.child(f.parent, 'terminal'))
    }
    await f.restart(child)
    for (const terminal of terminals) {
      await invoke(f.page(), 'canvas.focus', { target: { kind: 'node', nodeId: terminal.id } })
      await expect
        .poll(
          async () => {
            const node = (
              await invoke<GetNodeResult>(f.page(), 'node.get', { nodeId: terminal.id }, 'query')
            ).node
            const sessions = await invoke<{ sessions: { sessionId: string; status: string }[] }>(
              f.page(),
              'session.list',
              null,
              'query',
            )
            return sessions.sessions.find(s => s.sessionId === node.sessionId)?.status
          },
          { timeout: 30_000 },
        )
        .toBe('running')
    }
    expectSpawnRefusal(
      await f.command(child, ['node', 'create', 'terminal', '--root-canvas']),
      'agent.spawn_concurrency_limit',
      1,
    )
  })
})
