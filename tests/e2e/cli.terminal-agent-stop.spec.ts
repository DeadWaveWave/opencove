import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { createAgentCommandPath } from './workspace-canvas.terminal-agent-overlay.helpers'
import { terminalCommand, jsonOutput } from './cli.terminal.helpers'

test('agent stop preserves a surviving shell and its unrelated foreground work', async () => {
  test.skip(process.platform === 'win32', 'Uses the existing POSIX terminal-agent command shim')
  test.setTimeout(120_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-terminal-stop-'))
  const commandDirectory = await createAgentCommandPath({
    scenario: 'jsonl-two-stage-ctrl-c-unbound',
  })
  const workspace = join(root, 'project')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: join(root, 'profile'),
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_CLAUDE_HOOK_INSTALL_FAILURE: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        PATH: `${commandDirectory}${delimiter}${process.env.PATH ?? ''}`,
        CODEX_HOME: join(root, 'profile', 'home', '.codex'),
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: 'project',
      workspaces: [
        {
          id: 'project',
          name: 'CLI terminal stop',
          path: workspace,
          activeSpaceId: 'space',
          nodes: [],
          spaces: [
            {
              id: 'space',
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 2400, height: 1400 },
            },
          ],
        },
      ],
    })
    // Both terminals must be created through the real grant-issuing path.
    const coordinator = await page.evaluate(
      async () =>
        await window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            spaceId: 'space',
            title: 'Coordinator',
            data: { shell: '/bin/sh' },
            frame: { x: 20, y: 20, width: 760, height: 540 },
          },
        }),
    )
    const coordinatorSession = coordinator.node.sessionId
    if (!coordinatorSession) {
      throw new Error('Coordinator has no session')
    }
    const caller = { nodeId: coordinator.node.id, sessionId: coordinatorSession }
    await expect(
      page.locator(`[data-id="${caller.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
    const created = jsonOutput(
      await terminalCommand(
        page,
        caller,
        'opencove node create terminal --title Target --shell /bin/sh --fields id,sessionId',
        'CREATE_TARGET',
      ),
    )
    const node = created.node as { id: string; sessionId: string }
    expect(node.sessionId).toBeTruthy()
    const target = { nodeId: node.id, sessionId: node.sessionId }
    const terminal = page.locator(`[data-id="${node.id}"] .terminal-node`)
    await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute(
      'aria-busy',
      'false',
      { timeout: 20_000 },
    )
    const input = terminal.locator('.xterm-helper-textarea')
    await input.focus()
    await page.keyboard.type('codex')
    await page.keyboard.press('Enter')
    const transcript = async () =>
      (await terminal.locator('.terminal-node__transcript').textContent()) ?? ''
    await expect.poll(transcript).toContain('[opencove-test-2c] codex ready')
    await page.keyboard.press('Control+C')
    await expect.poll(transcript).toContain('codex cancel-alt-exit')
    await page.keyboard.press('Control+C')
    await expect.poll(transcript).toContain('codex provider-exit')
    const run = () =>
      page.evaluate(
        async nodeId =>
          await window.opencoveApi.controlSurface.invoke<{ state: string }>({
            kind: 'query',
            id: 'agent.get',
            payload: { nodeId },
          }),
        node.id,
      )
    await expect.poll(run).toMatchObject({ state: 'exited' })
    const cliStop = async (label: string) =>
      jsonOutput(await terminalCommand(page, caller, 'opencove agent stop --node Target', label))
    const noOp = {
      nodeId: node.id,
      sessionId: node.sessionId,
      stopped: false,
      reason: 'not_running',
    }
    expect(await cliStop('STOP_EXITED_AGENT')).toEqual(noOp)
    // The shell now runs work unrelated to the exited agent. Assemble the marker so echo cannot pass.
    const accepted = await page.evaluate(
      async binding =>
        await window.opencoveApi.controlSurface.invoke<{ accepted: boolean }>({
          kind: 'command',
          id: 'session.writeNode',
          payload: { ...binding, data: "printf '\\n%s%s\\n' unrelated- work; sleep 30\r" },
        }),
      target,
    )
    expect(accepted.accepted).toBe(true)
    await expect.poll(transcript).toContain('unrelated-work')
    expect(await cliStop('STOP_DURING_OTHER_WORK')).toEqual(noOp)
    // End only this test's foreground sleep, then prove the same shell binding is still usable.
    await page.evaluate(
      async binding =>
        await window.opencoveApi.controlSurface.invoke({
          kind: 'command',
          id: 'session.writeNode',
          payload: { ...binding, data: '\u0003' },
        }),
      target,
    )
    expect(
      jsonOutput(
        await terminalCommand(
          page,
          target,
          'opencove node get --node @self --fields id',
          'TARGET_SURVIVES',
        ),
      ),
    ).toEqual({ node: { id: node.id } })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(commandDirectory)
      await removePathWithRetry(root)
    }
  }
})
