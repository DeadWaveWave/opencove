import { expect, test, type ElectronApplication } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { version } from '../../package.json'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { jsonOutput, terminalCommand } from './cli.terminal.helpers'

const topics = ['canvas', 'coordinate', 'wait', 'read', 'access']

test('a canvas terminal reads the bundled core and every skill topic through its CLI shim', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-skill-'))
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
        OPENCOVE_E2E_DISABLE_CRASH_FALLBACK: '1',
      },
    })
    app = launched.electronApp
    const page = launched.window
    await seedWorkspaceState(page, {
      activeWorkspaceId: 'skill-project',
      workspaces: [
        {
          id: 'skill-project',
          name: 'Skill project',
          path: workspace,
          activeSpaceId: 'skill-main',
          nodes: [],
          spaces: [
            {
              id: 'skill-main',
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 20, y: 20, width: 1300, height: 800 },
            },
          ],
        },
      ],
    })
    // Create a real granted PTY; never seed a session or inject identity credentials.
    const created = await page.evaluate(
      async shell => {
        return await window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: 'skill-main' },
            title: 'Skill terminal',
            frame: { x: 100, y: 100, width: 900, height: 540 },
            data: { shell },
          },
        })
      },
      process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    )
    expect(created.node.sessionId).toBeTruthy()
    if (!created.node.sessionId) {
      throw new Error('Created terminal has no session ID')
    }
    const binding = { nodeId: created.node.id, sessionId: created.node.sessionId }
    const terminal = page.locator(`[data-id="${binding.nodeId}"] .terminal-node`)
    await expect(terminal).toBeVisible({ timeout: 15_000 })
    await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute(
      'aria-busy',
      'false',
      {
        timeout: 20_000,
      },
    )

    for (const topic of ['', ...topics]) {
      const args = topic ? `skill ${topic}` : 'skill'
      // Commands share a PTY: each framed result must finish before the next starts.
      const result = jsonOutput(
        // eslint-disable-next-line no-await-in-loop
        await terminalCommand(
          page,
          binding,
          `opencove ${args} -o json`,
          `SKILL_${topic || 'CORE'}`,
        ),
      )
      const content = readFileSync(
        `src/app/cli/skill/${topic ? `topics/${topic}.md` : 'SKILL.md'}`,
        'utf8',
      )
      expect(result).toEqual({ version, content, ...(topic ? { topic } : {}) })
    }
    const projected = jsonOutput(
      await terminalCommand(
        page,
        binding,
        'opencove skill read --fields version,topic',
        'SKILL_FIELDS',
      ),
    )
    expect(projected).toEqual({ version, topic: 'read' })
    const unknown = (
      await terminalCommand(page, binding, 'opencove skill missing -o json', 'SKILL_UNKNOWN')
    ).replaceAll('\n', '')
    expect(unknown).toMatch(/\bexit=2\b/)
    // jsonOutput intentionally rejects nonzero exits; parse this error separately.
    const error = JSON.parse(
      unknown.slice(unknown.indexOf('{'), unknown.lastIndexOf('}') + 1),
    ).error
    expect(error.code).toBe('cli.usage')
    for (const topic of topics) {
      expect(error.message).toContain(topic)
    }
    const help = (
      await terminalCommand(page, binding, 'opencove --help', 'SKILL_DISCOVERY')
    ).replace(/\s+/g, ' ')
    expect(help).toContain('opencove skill')
    expect(help).toMatch(/\bexit=0\b/)
  } finally {
    try {
      await app?.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
