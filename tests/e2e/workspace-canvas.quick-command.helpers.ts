import { expect, type TestInfo } from '@playwright/test'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { openPaneContextMenuInSpace } from './workspace-canvas.arrange.shared'
import { startWorker, stopWorker } from './worker-client.helpers'

export async function verifyTerminalQuickCommand(
  scope: 'root' | 'mount',
  testInfo: TestInfo,
): Promise<void> {
  const markerPath = testInfo.outputPath('quick-command.txt')
  await mkdir(path.dirname(markerPath), { recursive: true })
  const command = buildNodeEvalCommand(
    `require('node:fs').appendFileSync(${JSON.stringify(markerPath)}, 'executed\\n')`,
  )
  const userDataDir = await createTestUserDataDir()
  const worker = await startWorker({ userDataDir })

  try {
    const { electronApp, window } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
      windowMode: 'offscreen',
      env: { OPENCOVE_WORKER_CLIENT: '1' },
    })
    try {
      await clearAndSeedWorkspace(window, [], {
        settings: {
          quickCommands: [
            {
              id: 'execution-probe',
              title: 'Execution probe',
              kind: 'terminal',
              command,
              enabled: true,
              pinned: scope === 'root',
            },
          ],
        },
        ...(scope === 'mount'
          ? {
              spaces: [
                {
                  id: 'quick-command-space',
                  name: 'Command space',
                  directoryPath: testWorkspacePath,
                  nodeIds: [],
                  rect: { x: 100, y: 100, width: 1000, height: 700 },
                },
              ],
            }
          : {}),
      })
      const pane = window.locator('.workspace-canvas .react-flow__pane')
      if (scope === 'mount') {
        await openPaneContextMenuInSpace(window, pane, 'quick-command-space')
        await window.getByTestId('workspace-context-quick-commands').hover()
        await window.getByTestId('workspace-context-quick-command-execution-probe').click()
      } else {
        await pane.click({ button: 'right', position: { x: 320, y: 220 } })
        await window.getByTestId('workspace-context-quick-command-pinned-execution-probe').click()
      }
      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect.poll(() => readFile(markerPath, 'utf8').catch(() => '')).toBe('executed\n')
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.terminal-node')).toHaveCount(1)
      await expect(window.locator('.terminal-node .terminal-node__terminal')).toHaveAttribute(
        'aria-busy',
        'false',
      )
      expect(await readFile(markerPath, 'utf8')).toBe('executed\n')
      await testInfo.attach('quick-command', {
        body: await window.screenshot(),
        contentType: 'image/png',
      })
    } finally {
      await electronApp.close()
    }
  } finally {
    await stopWorker(worker.child)
    await removePathWithRetry(userDataDir)
  }
}
