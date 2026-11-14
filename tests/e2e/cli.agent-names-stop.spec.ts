import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { terminalCommand, jsonOutput } from './cli.terminal.helpers'

const projectId = 'cli-names-project'
const spaceId = 'cli-names-space'

test('CLI names survive session titles, rename by name and stop without removing the node', async () => {
  test.setTimeout(120_000)
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-names-'))
  const workspace = join(root, 'project')
  const profile = join(root, 'profile')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: profile,
      cleanupUserDataDir: false,
      env: {
        OPENCOVE_TEST_WORKSPACE: workspace,
        OPENCOVE_WORKER_CLIENT: '0',
        OPENCOVE_TEST_USE_REAL_AGENTS: '0',
        OPENCOVE_TEST_ENABLE_SESSION_STATE_WATCHER: '1',
        OPENCOVE_TEST_AGENT_SESSION_SCENARIO: 'codex-title-from-first-input',
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
        CODEX_HOME: join(profile, 'home', '.codex'),
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: projectId,
      workspaces: [
        {
          id: projectId,
          name: 'CLI names',
          path: workspace,
          activeSpaceId: spaceId,
          nodes: [],
          spaces: [
            {
              id: spaceId,
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 2400, height: 1400 },
            },
          ],
        },
      ],
    })
    // The bootstrap shell receives the real interact grant, just as cli.agent-identity does.
    const shell = await page.evaluate(
      async payload =>
        await window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: payload.spaceId },
            title: 'Coordinator',
            frame: { x: 20, y: 20, width: 760, height: 540 },
            data: { shell: payload.shell },
          },
        }),
      { spaceId, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' },
    )
    const sessionId = shell.node.sessionId
    expect(sessionId).toBeTruthy()
    if (!sessionId) {
      throw new Error('Coordinator terminal has no session')
    }
    const binding = { nodeId: shell.node.id, sessionId }
    await expect(
      page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
    const cli = async (command: string, label: string) =>
      jsonOutput(await terminalCommand(page, binding, command, label))
    const created = await cli(
      'opencove node create agent --provider codex --title "codex · Reviewer" --fields id,title,sessionId',
      'CREATE_NAMED',
    )
    const named = created.node as { id: string; title: string; sessionId: string }
    expect(named.title).toBe('codex · Reviewer')
    expect(named.sessionId).toBeTruthy()
    // Positive control: the same fixture must actually deliver an automatic session title.
    const autoResult = await cli(
      'opencove node create agent --provider codex --fields id,sessionId',
      'CREATE_AUTO',
    )
    const automatic = autoResult.node as { id: string; sessionId: string }
    for (const node of [named, automatic]) {
      await expect(page.locator(`[data-id="${node.id}"] .terminal-node__terminal`)).toHaveAttribute(
        'aria-busy',
        'false',
        { timeout: 20_000 },
      )
      // Drive the existing first-input fixture, not agent prompt (this fixture has no prompt hooks).
      const accepted = await page.evaluate(
        async target =>
          await window.opencoveApi.controlSurface.invoke<{ accepted: boolean }>({
            kind: 'command',
            id: 'session.writeNode',
            payload: {
              nodeId: target.id,
              sessionId: target.sessionId,
              data: 'Session title arrived\r',
            },
          }),
        node,
      )
      expect(accepted.accepted).toBe(true)
    }
    await expect(
      page.locator(`[data-id="${automatic.id}"] [data-testid="terminal-node-title-display"]`),
    ).toHaveText('Session title arrived', { timeout: 15_000 })
    // Observe completion on the named session too, so merely checking its initial title cannot pass.
    await expect
      .poll(
        async () =>
          await page.evaluate(
            async nodeId =>
              await window.opencoveApi.controlSurface.invoke<{ turnOutcome: string | null }>({
                kind: 'query',
                id: 'agent.get',
                payload: { nodeId },
              }),
            named.id,
          ),
        { timeout: 15_000 },
      )
      .toMatchObject({ turnOutcome: 'completed' })
    await expect(
      page.locator(`[data-id="${named.id}"] [data-testid="terminal-node-title-display"]`),
    ).toHaveText('codex · Reviewer')
    expect(
      await cli('opencove node get --node "codex · Reviewer" --fields id,title', 'RESOLVE_NAME'),
    ).toEqual({ node: { id: named.id, title: 'codex · Reviewer' } })
    const renamed = await cli(
      'opencove node update agent --node "codex · Reviewer" --title "codex · Lead" --fields id,title',
      'RENAME_AGENT',
    )
    expect(renamed).toMatchObject({ node: { id: named.id, title: 'codex · Lead' } })
    await expect(
      page.locator(`[data-id="${named.id}"] [data-testid="terminal-node-title-display"]`),
    ).toHaveText('codex · Lead')
    // Capture an unpinned renderer candidate, then publish it after a concurrent CLI rename.
    const stale = await page.evaluate(async nodeId => {
      const snapshot = await window.opencoveApi.persistence.readAppState()
      const state = snapshot.state as {
        workspaces: Array<{
          nodes: Array<{ id: string; title: string; titlePinnedByUser?: boolean }>
        }>
      }
      const pending = state.workspaces
        .flatMap(project => project.nodes)
        .find(node => node.id === nodeId)
      if (!pending || pending.titlePinnedByUser || snapshot.revision === null) {
        throw new Error('Expected an unpinned agent and a revisioned snapshot')
      }
      pending.title = 'codex · Pending renderer title'
      return { state, baseRevision: snapshot.revision }
    }, automatic.id)
    expect(
      await cli(
        `opencove node update agent --node ${automatic.id} --title "Auto lead" --fields id,title`,
        'PIN_AUTOMATIC',
      ),
    ).toMatchObject({ node: { id: automatic.id, title: 'Auto lead' } })
    const published = await page.evaluate(
      async payload => await window.opencoveApi.persistence.writeAppState(payload),
      stale,
    )
    expect(published.ok).toBe(true)
    expect(
      await cli(
        'opencove node get --node "Auto lead" --fields id,title',
        'PIN_SURVIVES_PUBLICATION',
      ),
    ).toEqual({ node: { id: automatic.id, title: 'Auto lead' } })
    await expect(
      page.locator(`[data-id="${automatic.id}"] [data-testid="terminal-node-title-display"]`),
    ).toHaveText('Auto lead')
    expect(await cli('opencove agent stop --node "codex · Lead"', 'STOP_AGENT')).toEqual({
      nodeId: named.id,
      sessionId: named.sessionId,
      stopped: true,
    })
    await expect
      .poll(
        async () =>
          await page.evaluate(
            async nodeId =>
              await window.opencoveApi.controlSurface.invoke<{ state: string }>({
                kind: 'query',
                id: 'agent.get',
                payload: { nodeId },
              }),
            named.id,
          ),
        { timeout: 15_000 },
      )
      .toMatchObject({ state: 'exited' })
    expect(await cli('opencove agent stop --node "codex · Lead"', 'STOP_AGAIN')).toEqual({
      nodeId: named.id,
      sessionId: named.sessionId,
      stopped: false,
      reason: 'not_running',
    })
    expect(
      await cli('opencove node get --node "codex · Lead" --fields id,title', 'NODE_REMAINS'),
    ).toEqual({
      node: { id: named.id, title: 'codex · Lead' },
    })
    await expect(page.locator(`[data-id="${named.id}"] .terminal-node`)).toBeVisible()
    expect(
      await cli(
        'opencove node update terminal --node Coordinator --title Console --fields id,title',
        'RENAME_TERMINAL',
      ),
    ).toMatchObject({ node: { id: binding.nodeId, title: 'Console' } })
    const refused = await terminalCommand(
      page,
      binding,
      'opencove agent stop --node Console -o json',
      'REFUSE_SHELL',
    )
    expect(refused).toMatch(/\bexit=1\b/)
    expect(refused).toContain('session kill')
    // A refused stop must leave the coordinator shell usable.
    expect(await cli('opencove node get --node @self --fields id', 'SHELL_SURVIVES')).toEqual({
      node: { id: binding.nodeId },
    })
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
