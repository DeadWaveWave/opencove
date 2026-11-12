import { terminalCommand, jsonOutput } from './cli.terminal.helpers'
import { cliCommand } from './recovery.managed-claude-launch-lifecycle.helpers'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect, test, type ElectronApplication } from '@playwright/test'
import { launchApp, seedWorkspaceState, removePathWithRetry } from './workspace-canvas.helpers'
import {
  createCliAgent,
  getBinding,
  projectId,
  spaceId,
} from './recovery.managed-claude-launch-lifecycle.helpers'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'

test('authenticated clear ordering commits without writing the store from the provider', async () => {
  test.setTimeout(150_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-clear-ordering-'))
  const home = join(root, 'home'),
    workspace = join(root, 'workspace'),
    profile = join(home, 'empty-profile'),
    log = join(root, 'events.jsonl')
  let app: ElectronApplication | undefined
  try {
    await mkdir(join(home, '.claude'), { recursive: true })
    await mkdir(workspace)
    await writeFile(profile, '')
    const launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        NODE_ENV: 'test',
        HOME: home,
        USERPROFILE: home,
        CLAUDE_CONFIG_DIR: join(home, '.claude'),
        ZDOTDIR: home,
        BASH_ENV: profile,
        ENV: profile,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'claude-clear-ordering',
        OPENCOVE_TEST_AGENT_STUB_SCRIPT: join(__dirname, 'fixtures/claude-clear-ordering.mjs'),
        OPENCOVE_TEST_CLEAR_LOG: log,
        ...(process.platform === 'win32' ? {} : { SHELL: '/bin/bash' }),
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
          name: 'Clear ordering',
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
      async ({ spaceId: targetSpaceId, shell }) =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: targetSpaceId },
            data: { shell },
          },
        }),
      { spaceId, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' },
    )
    expect(terminal.node.sessionId).toBeTruthy()
    const agent = await createCliAgent(page, {
      nodeId: terminal.node.id,
      sessionId: terminal.node.sessionId!,
    })
    const records = async () =>
      (await readFile(log, 'utf8').catch(() => ''))
        .split('\n')
        .filter(Boolean)
        .map(
          line =>
            JSON.parse(line) as {
              scenario?: string
              id: string
              pastes?: number
              enters?: number
              text?: string
            },
        )
    await expect.poll(async () => (await records()).length).toBe(1)
    for (const scenario of [
      'reverse',
      'stop-before-start',
      'same-id',
      'late-old',
      'held-transcript',
    ]) {
      // The stub uses the reservation token, real HTTP normalization and valid exact-file transcripts.
      // Write through the Worker like other control-surface tests; renderer pty.write would race the
      // renderer's own first attachment of a session the CLI has just created.
      // oxlint-disable-next-line no-await-in-loop
      const written = await page.evaluate(
        async ({ nodeId, sessionId, scenario: command }) =>
          await window.opencoveApi.controlSurface.invoke<{ accepted: boolean }>({
            kind: 'command',
            id: 'session.writeNode',
            payload: { nodeId, sessionId, data: command + '\r' },
          }),
        { nodeId: agent.id, sessionId: agent.sessionId, scenario },
      )
      expect(written.accepted).toBe(true)
      // oxlint-disable-next-line no-await-in-loop
      await expect
        .poll(async () => (await records()).some(record => record.scenario === scenario))
        .toBe(true)
      // oxlint-disable-next-line no-await-in-loop
      const expected = (await records()).find(record => record.scenario === scenario)!.id
      // oxlint-disable-next-line no-await-in-loop
      await expect
        .poll(() => getBinding(page, agent.id))
        .toMatchObject({ tuple: { resumeSessionId: expected, resumeSessionIdVerified: true } })
    }
    const caller = { nodeId: terminal.node.id, sessionId: terminal.node.sessionId! }
    const write = async (data: string) =>
      page.evaluate(
        async payload =>
          window.opencoveApi.controlSurface.invoke({
            kind: 'command',
            id: 'session.writeNode',
            payload,
          }),
        { nodeId: agent.id, sessionId: agent.sessionId, data: data + '\r' },
      )
    await write('clear-input')
    await expect
      .poll(async () => (await records()).some(r => r.scenario === 'clear-input'))
      .toBe(true)
    const b = (await records()).find(r => r.scenario === 'clear-input')!.id
    const delivered = jsonOutput(
      await terminalCommand(
        page,
        caller,
        cliCommand(
          'agent',
          'prompt',
          '--node',
          agent.id,
          '--text',
          'FIRST_B_INPUT',
          '--timeout',
          '10s',
        ),
        'PROMPT_B',
      ),
    )
    expect(delivered).toMatchObject({ phase: 'submission_observed', textComparison: 'matched' })
    const turnId = delivered.turnId as string
    const waited = jsonOutput(
      await terminalCommand(
        page,
        caller,
        cliCommand('agent', 'wait', '--node', agent.id, '--turn', turnId, '--timeout', '10s'),
        'WAIT_B',
      ),
    )
    expect(waited).toMatchObject({ turnId, outcome: 'completed' })
    const reply = jsonOutput(
      await terminalCommand(
        page,
        caller,
        cliCommand('agent', 'read', '--node', agent.id, '--turn', turnId, '-o', 'json'),
        'READ_B',
      ),
    )
    expect(reply).toMatchObject({ turnId, message: 'ORDERED_REPLY' })
    await expect
      .poll(async () => (await records()).find(r => r.scenario === 'submitted-input'))
      .toMatchObject({ id: b, text: 'FIRST_B_INPUT', pastes: 1, enters: 1 })

    await write('clear-after-paste')
    await expect
      .poll(async () => (await records()).some(r => r.scenario === 'clear-after-paste'))
      .toBe(true)
    const interrupted = await terminalCommand(
      page,
      caller,
      cliCommand(
        'agent',
        'prompt',
        '--node',
        agent.id,
        '--text',
        'CANCEL_BEFORE_ENTER',
        '--timeout',
        '10s',
      ),
      'INTERRUPTED',
    )
    expect(interrupted).toContain('agent.prompt_interrupted')
    await expect
      .poll(async () => (await records()).find(r => r.scenario === 'cleared-after-paste'))
      .toMatchObject({ pastes: 2, enters: 1 })
    expect((await records()).filter(r => r.scenario === 'submitted-input')).toHaveLength(1)

    for (const [index, mode] of ['unreported-dialog', 'slash-menu', 'pending-output'].entries()) {
      // oxlint-disable-next-line no-await-in-loop -- each opaque surface is a fresh conversation
      await write(mode)
      // oxlint-disable-next-line no-await-in-loop
      await expect.poll(async () => (await records()).some(r => r.scenario === mode)).toBe(true)
      // oxlint-disable-next-line no-await-in-loop
      const stalled = await terminalCommand(
        page,
        caller,
        cliCommand(
          'agent',
          'prompt',
          '--node',
          agent.id,
          '--text',
          'OPAQUE_SURFACE_INPUT',
          '--timeout',
          '10s',
        ),
        `OPAQUE_${index}`,
      )
      expect(stalled).toContain('agent.prompt_stalled')
      expect(stalled).toMatch(/"pasteDispatchAttempted"\s*:\s*true/)
      expect(stalled).toMatch(/"submitDispatchAttempted"\s*:\s*true/)
      // oxlint-disable-next-line no-await-in-loop
      expect((await records()).filter(r => r.scenario === 'consumed-input')).toHaveLength(index + 1)
    }
    await write('waiting-input')
    await expect
      .poll(async () => (await records()).some(r => r.scenario === 'waiting-input'))
      .toBe(true)
    const blocked = await terminalCommand(
      page,
      caller,
      cliCommand(
        'agent',
        'prompt',
        '--node',
        agent.id,
        '--text',
        'MUST_NOT_WRITE',
        '--timeout',
        '10s',
      ),
      'OBSERVED_WAITING',
    )
    expect(blocked).toContain('agent.blocked')
    expect(blocked).toMatch(/"pasteDispatchAttempted"\s*:\s*false/)
    await write('delayed-input')
    await expect
      .poll(async () => (await records()).some(r => r.scenario === 'delayed-input'))
      .toBe(true)
    const busy = await terminalCommand(
      page,
      caller,
      cliCommand(
        'agent',
        'prompt',
        '--node',
        agent.id,
        '--text',
        'MUST_NOT_WRITE',
        '--timeout',
        '10s',
      ),
      'DELAYED_START_BUSY',
    )
    expect(busy).toContain('agent.busy')
    expect((await records()).filter(r => r.scenario === 'submitted-input')).toHaveLength(1)
  } finally {
    await app?.close()
    await removePathWithRetry(root)
  }
})
