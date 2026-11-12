import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { expect, test, type ElectronApplication } from '@playwright/test'
import type { CreateNodeResult } from '../../src/shared/contracts/dto'
import {
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seedWorkspaceState,
} from './workspace-canvas.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'
import { openPaneContextMenuInSpace } from './workspace-canvas.arrange.shared'
import {
  createCliAgent,
  getBinding,
  launch,
  projectId,
  spaceId,
} from './recovery.managed-claude-launch-lifecycle.helpers'

interface Invocation {
  mode: string
  sessionId: string
  cwd: string
  pid: number
}
async function invocations(logPath: string): Promise<Invocation[]> {
  return (await readFile(logPath, 'utf8').catch(() => ''))
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line) as Invocation)
}
async function ledger(app: ElectronApplication, userDataDir: string) {
  return app.evaluate(
    (_electron, input) => {
      const require = process.getBuiltinModule('module').createRequire(input.packagePath)
      const Database = require('better-sqlite3') as typeof import('better-sqlite3')
      const db = new Database(input.dbPath, { readonly: true })
      try {
        return db
          .prepare(
            `SELECT b.node_id, b.resume_session_id, b.runtime_session_id, b.node_seen,
        n.session_id, n.agent_json FROM managed_claude_resume_bindings b LEFT JOIN nodes n ON n.id = b.node_id ORDER BY b.node_id`,
          )
          .all() as Array<{
          node_id: string
          resume_session_id: string
          runtime_session_id: string
          node_seen: number
          session_id: string
          agent_json: string
        }>
      } finally {
        db.close()
      }
    },
    { dbPath: path.join(userDataDir, 'opencove.db'), packagePath: path.resolve('package.json') },
  )
}
async function expectInvocation(logPath: string, _nodeId: string, mode: string, id: string) {
  await expect
    .poll(
      async () =>
        (await invocations(logPath)).filter(call => call.sessionId === id && call.mode === mode)
          .length,
    )
    .toBeGreaterThan(0)
}

test('managed Claude relaunch, switch, role identity and cold restart use committed bindings', async () => {
  test.setTimeout(180_000)
  const userDataDir = await createTestUserDataDir()
  const home = path.join(userDataDir, 'home'),
    workspace = path.join(userDataDir, 'workspace')
  const profile = path.join(home, 'empty-profile'),
    logPath = path.join(userDataDir, 'invocations.jsonl')
  await mkdir(path.join(home, '.claude'), { recursive: true })
  await mkdir(workspace, { recursive: true })
  await mkdir(path.join(userDataDir, 'runtime'), { recursive: true, mode: 0o700 })
  await writeFile(profile, '')
  const env = {
    NODE_ENV: 'test',
    HOME: home,
    USERPROFILE: home,
    CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    ZDOTDIR: home,
    BASH_ENV: profile,
    ENV: profile,
    XDG_CONFIG_HOME: path.join(home, '.config'),
    XDG_DATA_HOME: path.join(home, '.local', 'share'),
    XDG_CACHE_HOME: path.join(home, '.cache'),
    XDG_STATE_HOME: path.join(home, '.local', 'state'),
    XDG_RUNTIME_DIR: path.join(userDataDir, 'runtime'),
    OPENCOVE_TEST_WORKSPACE: workspace,
    OPENCOVE_WORKER_CLIENT: '1',
    OPENCOVE_TEST_USE_REAL_AGENTS: '0',
    OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
    OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
    OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-session-ownership',
    OPENCOVE_TEST_AGENT_STUB_SCRIPT: path.join(__dirname, 'fixtures/claude-session-ownership.mjs'),
    OPENCOVE_TEST_CLAUDE_OWNERSHIP_LOG: logPath,
    ANTHROPIC_API_KEY: '',
    ANTHROPIC_AUTH_TOKEN: '',
    CLAUDE_CODE_OAUTH_TOKEN: '',
    ...(process.platform === 'win32' ? {} : { SHELL: '/bin/bash' }),
  }
  let worker: ChildProcessWithoutNullStreams | null = null
  let app: ElectronApplication | undefined
  try {
    worker = (await startWorker({ userDataDir, env })).child
    worker.stdout.resume()
    worker.stderr.resume()
    const first = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    app = first.electronApp
    const page = first.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'claude-code', agentFullAccess: false },
      workspaces: [
        {
          id: projectId,
          name: 'Managed launch',
          path: workspace,
          activeSpaceId: spaceId,
          nodes: [],
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 5000, height: 3000 },
            },
          ],
        },
      ],
    })
    const terminal = await page.evaluate(
      async targetSpaceId =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: targetSpaceId },
            data: { shell: navigator.platform.includes('Win') ? 'powershell.exe' : '/bin/sh' },
          },
        }),
      spaceId,
    )
    const cliBinding = { nodeId: terminal.node.id, sessionId: terminal.node.sessionId! }
    await expect(
      page.locator(`[data-id="${cliBinding.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
    const agent = await createCliAgent(page, cliBinding)
    const initial = await getBinding(page, agent.id)
    await expectInvocation(logPath, agent.id, 'new', initial.tuple.resumeSessionId!)

    const relaunched = await launch(page, agent.id, workspace, {
      kind: 'launchNew',
      expected: { activationId: initial.activationId, tuple: initial.tuple },
    })
    const next = relaunched.managedClaudeLifecycle!.binding
    expect(next.nodeId).toBe(agent.id)
    expect(next.tuple.resumeSessionId).not.toBe(initial.tuple.resumeSessionId)
    expect(next.runtimeSessionId).not.toBe(initial.runtimeSessionId)
    await expect
      .poll(
        async () =>
          (await ledger(app!, userDataDir)).find(row => row.node_id === agent.id)
            ?.resume_session_id,
      )
      .toBe(next.tuple.resumeSessionId)
    await expectInvocation(logPath, agent.id, 'new', next.tuple.resumeSessionId!)

    // The first transcript already exists, so the stub can prove the exact selected conversation.
    const switched = await launch(page, agent.id, workspace, {
      kind: 'resumeConversation',
      resumeSessionId: initial.tuple.resumeSessionId!,
      expected: { activationId: next.activationId, tuple: next.tuple },
    })
    expect(switched.managedClaudeLifecycle?.binding.tuple).toEqual(initial.tuple)
    await expectInvocation(logPath, agent.id, 'resume', initial.tuple.resumeSessionId!)

    await openPaneContextMenuInSpace(
      page,
      page.locator('.workspace-canvas .react-flow__pane'),
      spaceId,
    )
    await page.getByTestId('workspace-context-run-role').click()
    await page.getByTestId('workspace-context-new-role').click()
    await page.getByTestId('workspace-role-name-input').fill('Session reviewer')
    await page.getByTestId('workspace-role-prompt-input').fill('Review the managed session fixture')
    await page.getByTestId('workspace-role-create').click()
    await expect(page.locator('.role-node')).toHaveCount(1)
    await page.getByTestId('role-node-run').click()
    const roleAgent = async () =>
      page.evaluate(async () => {
        const state = JSON.parse(
          (await window.opencoveApi.persistence.readWorkspaceStateRaw()) ?? '{}',
        )
        const role = state.workspaces?.[0]?.nodes?.find(
          (node: { kind: string }) => node.kind === 'role',
        )
        return {
          roleId: role?.id as string,
          agentId: role?.task?.linkedAgentNodeId as string | undefined,
          record: role?.task?.runHistory?.[0] as { agentNodeId: string } | undefined,
        }
      })
    await expect.poll(async () => (await roleAgent()).agentId).toBeTruthy()
    const role = await roleAgent()
    expect(role.agentId).not.toBe(role.roleId)
    expect(role.record?.agentNodeId).toBe(role.agentId)
    await expect
      .poll(async () => (await ledger(app!, userDataDir)).map(row => row.node_id))
      .toContain(role.agentId)
    expect((await ledger(app, userDataDir)).map(row => row.node_id)).not.toContain(role.roleId)

    const roleBinding = await getBinding(page, role.agentId!)
    await expectInvocation(logPath, role.agentId!, 'new', roleBinding.tuple.resumeSessionId!)
    const beforeRestart = await getBinding(page, agent.id)
    const invocationCount = (await invocations(logPath)).length
    await app.close()
    app = undefined
    await stopWorker(worker)
    worker = null
    worker = (await startWorker({ userDataDir, env })).child
    worker.stdout.resume()
    worker.stderr.resume()
    const restarted = await launchApp({ userDataDir, cleanupUserDataDir: false, env })
    app = restarted.electronApp
    await expect
      .poll(async () =>
        (await invocations(logPath))
          .slice(invocationCount)
          .some(
            call =>
              call.mode === 'resume' && call.sessionId === beforeRestart.tuple.resumeSessionId,
          ),
      )
      .toBe(true)
    // A stale client hint still cannot replace the committed conversation after a cold restart.
    const resumed = await launch(
      restarted.window,
      agent.id,
      workspace,
      { kind: 'resumeCurrent' },
      next.tuple.resumeSessionId!,
    )
    expect(resumed.resumeSessionId).toBe(beforeRestart.tuple.resumeSessionId)
    const rows = await ledger(app, userDataDir)
    const persisted = rows.find(row => row.node_id === agent.id)!
    expect(persisted.node_seen).toBe(1)
    expect(persisted.session_id).toBe(persisted.runtime_session_id)
    expect(JSON.parse(persisted.agent_json).resumeSessionId).toBe(
      beforeRestart.tuple.resumeSessionId,
    )
  } finally {
    try {
      await app?.close()
    } finally {
      await stopWorker(worker)
      await removePathWithRetry(userDataDir)
    }
  }
})
