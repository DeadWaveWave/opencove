import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import type { AgentRunSnapshot } from '../../src/shared/contracts/dto/agentRunState'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { terminalCommand } from './cli.terminal.helpers'
import { assertFullAccessChoice } from './cli.session-grant.helpers'
import {
  cli,
  projectId,
  spaceId,
  worktreeSpace,
  grantCliCommands,
  assertHumanDecisionDenied,
} from '../support/cliSessionGrant'

// Backend matrices live in worker-cli; this journey owns Desktop projection and the
// trusted renderer / denied granted CLI boundary at a real provider permission dialog.
test('session grants preserve agent workflows and refuse human decisions', async () => {
  test.setTimeout(90_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-grants-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  const record = join(root, 'prompt-record.jsonl'),
    dialog = join(root, 'dialog')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-prompt-strict',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        CLAUDE_CONFIG_DIR: join(root, 'claude'),
        CODEX_HOME: join(root, 'codex'),
        OPENCOVE_TEST_PROMPT_RECORD: record,
        OPENCOVE_TEST_PROMPT_DIALOG: dialog,
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      settings: { defaultProvider: 'claude-code', agentFullAccess: false },
      workspaces: [
        {
          id: projectId,
          name: 'Grant project',
          path: workspace,
          activeSpaceId: spaceId,
          nodes: [],
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 1600, height: 1000 },
            },
            {
              id: worktreeSpace,
              name: 'Worktree',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 1800, y: 0, width: 800, height: 600 },
            },
          ],
        },
      ],
    })
    const created = await page.evaluate(
      async ({ spaceId: targetSpaceId, shell }) =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: targetSpaceId },
            title: 'Grant CLI',
            data: { shell },
          },
        }),
      { spaceId, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' },
    )
    const binding = { nodeId: created.node.id, sessionId: created.node.sessionId! }
    expect(binding.sessionId).toBeTruthy()
    const command = (...args: string[]) =>
      terminalCommand(page, binding, cli(...args), args.slice(0, 2).join('_'))
    const { success, object } = grantCliCommands(command)
    await success('canvas', 'focus', 'node', '--node', binding.nodeId)
    await expect(
      page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false')
    const agent = await object(
      'node',
      'create',
      'agent',
      '--provider',
      'claude-code',
      '--prompt',
      '',
      '--full-access',
      'true',
    )
    const agentNode = agent.node as { id: string; sessionId: string }
    const focused = await object('canvas', 'focus', 'node', '--node', agentNode.id)
    expect(focused.delivered).toBe(true)
    const terminal = page.locator(`[data-id="${agentNode.id}"] .terminal-node__terminal`)
    await expect(terminal).toHaveAttribute('aria-busy', 'false')
    // canvas.focus requests viewport navigation; it does not request terminal input focus.
    await expect(terminal).toBeInViewport()
    await assertFullAccessChoice(page, agentNode.id)
    const agentSnapshot = () =>
      page.evaluate(
        async id =>
          window.opencoveApi.controlSurface.invoke<AgentRunSnapshot>({
            kind: 'query',
            id: 'agent.get',
            payload: { sessionId: id },
          }),
        agentNode.sessionId,
      )
    await expect
      .poll(async () =>
        page.evaluate(
          async id => (await window.opencoveApi.pty.snapshot({ sessionId: id })).data,
          agentNode.sessionId,
        ),
      )
      .toContain('STRICT_READY')
    // A trusted UI turn establishes readiness; startup idle alone is insufficient.
    await page.evaluate(
      async targetBinding =>
        window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'session.writeNode',
          payload: { ...targetBinding, data: 'manual baseline\r' },
        }),
      { nodeId: agentNode.id, sessionId: agentNode.sessionId },
    )
    await expect
      .poll(async () =>
        page.evaluate(
          async id => (await window.opencoveApi.pty.snapshot({ sessionId: id })).data,
          agentNode.sessionId,
        ),
      )
      .toContain('STRICT_TURN_1')
    await expect.poll(async () => (await agentSnapshot()).state).toBe('idle')
    await writeFile(dialog, 'permission')
    // The hook publishes waiting before the stub appends its dialog-entry record.
    // Include that record in the baseline so only unexpected input changes it.
    await expect.poll(() => readFile(record, 'utf8')).toContain('{"kind":"dialog","bytes":0}\n')
    await expect.poll(async () => (await agentSnapshot()).state).toBe('waiting')
    const before = await readFile(record, 'utf8')
    await assertHumanDecisionDenied({ command, root, agentNode })
    expect(await readFile(record, 'utf8')).toBe(before)
    await expect.poll(async () => (await agentSnapshot()).state).toBe('waiting')
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
