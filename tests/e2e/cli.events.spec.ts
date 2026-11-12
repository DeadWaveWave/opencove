import { expect, test, type ElectronApplication } from '@playwright/test'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'
import { launchApp, removePathWithRetry, seedWorkspaceState } from './workspace-canvas.helpers'
import { terminalCommand } from './cli.terminal.helpers'

test('a granted canvas terminal opens NDJSON observation and times out without controlling agents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-cli-events-'))
  const workspace = join(root, 'project'),
    profile = join(root, 'profile')
  let app: ElectronApplication | undefined
  try {
    await mkdir(workspace)
    const launched = await launchApp({
      userDataDir: profile,
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
      activeWorkspaceId: 'events-project',
      workspaces: [
        {
          id: 'events-project',
          name: 'Events project',
          path: workspace,
          activeSpaceId: 'events-main',
          nodes: [],
          spaces: [
            {
              id: 'events-main',
              name: 'Main',
              directoryPath: workspace,
              nodeIds: [],
              rect: { x: 0, y: 0, width: 1200, height: 900 },
            },
          ],
        },
      ],
    })
    const created = await page.evaluate(
      async shell =>
        window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
          kind: 'command',
          id: 'node.create',
          payload: {
            kind: 'terminal',
            space: { kind: 'spaceId', spaceId: 'events-main' },
            title: 'Observer',
            data: { shell },
          },
        }),
      process.platform === 'win32' ? 'powershell.exe' : '/bin/sh',
    )
    expect(created.node.sessionId).toBeTruthy()
    const binding = { nodeId: created.node.id, sessionId: created.node.sessionId! }
    await expect(
      page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
    ).toHaveAttribute('aria-busy', 'false', { timeout: 20000 })
    // Explicit selectors exercise real lookup; the terminal supplies its genuine session grant.
    const output = await terminalCommand(
      page,
      binding,
      'opencove events --space Main --timeout 2s -o json',
      'EVENTS_TIMEOUT',
    )
    expect(output).toMatch(/exit=124/)
    // ConPTY can wrap JSON lines, so search the complete framed payload after joining rows.
    const compact = output.replaceAll('\n', '')
    expect(compact).toContain('"type":"stream.ready"')
    expect(compact).toContain('"spaceId":"events-main"')
    expect(compact).toContain('"code":"events.timeout"')
    const rejected = await terminalCommand(
      page,
      binding,
      'opencove events --type app_state.updated -o json',
      'EVENTS_INVALID',
    )
    expect(rejected).toMatch(/exit=2/)
    expect(rejected).not.toContain('"type":"stream.ready"')
    // Ordinary terminal input remains usable after cancelling the observer.
    const identity = await terminalCommand(
      page,
      binding,
      'opencove whoami -o json',
      'EVENTS_IDENTITY',
    )
    expect(identity).toMatch(/exit=0/)
    expect(identity.replaceAll('\n', '')).toContain('"nodeId":"' + binding.nodeId + '"')
  } finally {
    await app?.close()
    await removePathWithRetry(root)
  }
})
