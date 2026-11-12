import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import {
  createLineageAgent,
  establishLineageAgentReady,
  grantedAgentCli,
  writeLineageAgentStub,
} from './cli.agent-lineage.helpers'
import type { CreateNodeResult, GetNodeResult } from '../../src/shared/contracts/dto/nodeControl'

test('grant ancestry survives renderer publications and restart, and a child reports to @parent', async () => {
  test.setTimeout(240_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-lineage-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const stub = await writeLineageAgentStub(root)
    const options = {
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: stub,
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
      },
    }
    let launched = await launchApp(options)
    app = launched.electronApp
    let page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: 'lineage-project',
      workspaces: [
        {
          id: 'lineage-project',
          name: 'Lineage project',
          path: workspace,
          activeSpaceId: null,
          nodes: [],
          spaces: [],
        },
      ],
    })
    const parent = await createLineageAgent(page, 'lineage-project')
    expect(parent.node).toMatchObject({ spawnedBy: null, lineageDepth: 1, lineageStatus: 'root' })
    await establishLineageAgentReady(page, parent.node)
    const stale = await page.evaluate(() => window.opencoveApi.persistence.readAppState())
    const childCli = await grantedAgentCli(root, parent.node.id, [
      'node',
      'create',
      'agent',
      '--root-canvas',
      '--provider',
      'claude-code',
      '--title',
      'Delegate',
    ])
    expect(childCli.code, childCli.stderr).toBe(0)
    const child = (JSON.parse(childCli.stdout) as CreateNodeResult).node
    expect(child).toMatchObject({
      spawnedBy: parent.node.id,
      lineageDepth: 2,
      lineageStatus: 'recorded',
    })
    await establishLineageAgentReady(page, child)
    const reply = await grantedAgentCli(root, child.id, [
      'agent',
      'prompt',
      '--node',
      '@parent',
      '--text',
      'Delegation complete',
      '--wait',
      '--read',
      '--timeout',
      '15s',
    ])
    expect(reply.code, reply.stderr).toBe(0)
    const reported = JSON.parse(reply.stdout)
    expect(reported).toMatchObject({
      nodeId: parent.node.id,
      sessionId: parent.node.sessionId,
      phase: 'submission_observed',
      outcome: 'completed',
      turnId: expect.any(String),
      reply: { message: 'Strict reply 2', source: 'hook' },
    })
    expect(reported.reply).toMatchObject({
      nodeId: parent.node.id,
      sessionId: reported.sessionId,
      turnId: reported.turnId,
      outcome: 'completed',
    })
    const filtered = await grantedAgentCli(root, parent.node.id, [
      'agent',
      'list',
      '--spawned-by',
      '@self',
      '--fields',
      'nodeId,spawnedBy,lineageDepth,lineageStatus',
    ])
    expect(filtered.code, filtered.stderr).toBe(0)
    expect(JSON.parse(filtered.stdout).agents).toEqual([
      expect.objectContaining({ nodeId: child.id, spawnedBy: parent.node.id, lineageDepth: 2 }),
    ])
    // Publish an unrelated edit from a renderer snapshot captured before child creation.
    const publication = await page.evaluate(async snapshot => {
      const state = snapshot.state as { settings: Record<string, unknown> }
      state.settings = { ...state.settings, language: 'en' }
      return window.opencoveApi.persistence.writeAppState({
        state,
        baseRevision: snapshot.revision,
      })
    }, stale)
    expect(publication.ok).toBe(true)
    const get = (id: string) =>
      page.evaluate(
        async nodeId =>
          window.opencoveApi.controlSurface.invoke<GetNodeResult>({
            kind: 'query',
            id: 'node.get',
            payload: { nodeId },
          }),
        id,
      )
    expect((await get(child.id)).node).toMatchObject({ spawnedBy: parent.node.id, lineageDepth: 2 })
    // A raw legacy-shaped publication can move/rename nodes but cannot forge ancestry.
    expect(
      await page.evaluate(async nodeId => {
        const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
        const state = JSON.parse(raw!)
        const node = state.workspaces
          .flatMap((w: { nodes: { id: string }[] }) => w.nodes)
          .find((n: { id: string }) => n.id === nodeId)
        Object.assign(node, {
          spawnedBy: 'forged',
          lineageDepth: 99,
          title: 'Moved delegate',
          position: { x: 1800, y: 300 },
        })
        state.workspaces[0].spaces.push({
          id: 'moved-space',
          name: 'Delegates',
          directoryPath: state.workspaces[0].path,
          nodeIds: [nodeId],
          rect: { x: 1780, y: 280, width: 1000, height: 800 },
        })
        return window.opencoveApi.persistence.writeWorkspaceStateRaw({ raw: JSON.stringify(state) })
      }, child.id),
    ).toMatchObject({ ok: true })
    await app.close()
    await rm(join(root, child.id + '.ready'), { force: true })
    app = undefined
    launched = await launchApp(options)
    app = launched.electronApp
    page = launched.window
    expect((await get(child.id)).node).toMatchObject({
      spawnedBy: parent.node.id,
      lineageDepth: 2,
      lineageStatus: 'recorded',
      spaceId: 'moved-space',
    })
    // Mount the recovered child and require evidence that its provider actually restarted.
    await page.evaluate(
      async nodeId =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'canvas.focus',
          payload: { target: { kind: 'node', nodeId } },
        }),
      child.id,
    )
    await expect
      .poll(
        async () => {
          try {
            return await readFile(join(root, child.id + '.ready'), 'utf8')
          } catch {
            return ''
          }
        },
        { timeout: 30_000 },
      )
      .toBe('ready')
    await expect(page.locator(`[data-id="${child.id}"] .terminal-node__terminal`)).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 20_000 },
    )
    // Ensure recovered child has a fresh grant before resolving its deleted parent.
    await expect
      .poll(
        () =>
          page.evaluate(
            async nodeId =>
              (
                await window.opencoveApi.controlSurface.invoke<GetNodeResult>({
                  kind: 'query',
                  id: 'node.get',
                  payload: { nodeId },
                })
              ).node.sessionId,
            child.id,
          ),
        { timeout: 20_000 },
      )
      .not.toBeNull()
    await page.evaluate(
      async nodeId =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'node.delete',
          payload: { nodeId },
        }),
      parent.node.id,
    )
    const deleted = await grantedAgentCli(root, child.id, ['node', 'get', '--node', '@parent'])
    expect(deleted.code).toBe(1)
    expect(deleted.stderr).toContain('parent_deleted')
    expect(deleted.stderr).toContain('"retryable":false')
    expect((await get(child.id)).node).toMatchObject({ spawnedBy: parent.node.id, lineageDepth: 2 })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})

test('task Run creates a root without adopting the task as its parent', async () => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-task-lineage-'))
  let app: ElectronApplication | undefined
  try {
    const workspace = join(root, 'project')
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: 'task-lineage',
      settings: { defaultProvider: 'claude-code' },
      workspaces: [
        {
          id: 'task-lineage',
          name: 'Task lineage',
          path: workspace,
          spaces: [],
          nodes: [
            {
              id: 'task-root',
              kind: 'task',
              title: 'Review',
              position: { x: 50, y: 50 },
              width: 460,
              height: 280,
              task: {
                requirement: 'Review the implementation',
                status: 'todo',
                linkedAgentNodeId: null,
                lastRunAt: null,
                autoGeneratedTitle: false,
              },
            },
          ],
        },
      ],
    })
    await page.locator('[data-testid="task-node-run-agent"]').click()
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const result = await window.opencoveApi.controlSurface.invoke<{
              nodes: GetNodeResult['node'][]
            }>({
              kind: 'query',
              id: 'node.list',
              payload: { projectId: 'task-lineage', kind: 'agent' },
            })
            return result.nodes.map(n => ({
              spawnedBy: n.spawnedBy,
              lineageDepth: n.lineageDepth,
              lineageStatus: n.lineageStatus,
            }))
          }),
        { timeout: 20_000 },
      )
      .toEqual([{ spawnedBy: null, lineageDepth: 1, lineageStatus: 'root' }])
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
