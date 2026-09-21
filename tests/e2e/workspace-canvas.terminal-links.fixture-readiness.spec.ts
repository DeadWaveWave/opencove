import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { access, mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  clearAndSeedWorkspace,
  launchApp,
  removePathWithRetry,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import {
  printTerminalLinkFixture,
  terminalLinkCellPoint,
} from './workspace-canvas.terminal-links.helpers'

const shellQuote = (value: string): string => `'${value.replaceAll("'", "'\\''")}'`

test('waits for fixture output when the old prompt contains the same path prefix', async () => {
  test.skip(process.platform === 'win32', 'The controlled startup gate uses a POSIX shell function')
  const directory = path.join(testWorkspacePath, 'artifacts', 'e2e', 'terminal-links', randomUUID())
  const filePath = path.join(directory, 'navigation.txt')
  const enteredPath = path.join(directory, 'node-entered')
  const gatePath = path.join(directory, 'node-release')
  await mkdir(directory, { recursive: true })
  await writeFile(filePath, 'fixture navigation target\n')
  const { electronApp, window } = await launchApp({
    windowMode: 'offscreen',
    env: { SHELL: '/bin/bash' },
  })
  const nodeId = 'fixture-prefix-collision'
  let release: Promise<void> | undefined
  try {
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: nodeId,
          title: 'fixture-prefix-collision',
          position: { x: 140, y: 120 },
          width: 720,
          height: 340,
          executionDirectory: testWorkspacePath,
        },
      ],
      { settings: { language: 'en', canvasInputMode: 'mouse' } },
    )
    const terminal = window.locator(`[data-id="${nodeId}"] .terminal-node`)
    await expect(terminal.locator('.xterm-helper-textarea')).toBeAttached()
    await terminal.locator('.xterm').click()
    const oldPrompt = `OLD PROMPT ${filePath.slice(0, 16)} WAITING FOR NODE`
    const setup = `node() { printf entered > ${shellQuote(enteredPath)}; while [ ! -e ${shellQuote(gatePath)} ]; do sleep 0.01; done; command node "$@"; }; printf '\\033[2J\\033[H%s\\r\\n' ${shellQuote(oldPrompt)}`
    await window.keyboard.type(setup)
    await window.keyboard.press('Enter')
    const firstRow = () =>
      window.evaluate(
        id => window.__opencoveTerminalSelectionTestApi?.getBufferText(id, '')?.viewportLines[0],
        nodeId,
      )
    await expect.poll(firstRow).toBe(oldPrompt)
    release = (async () => {
      await expect
        .poll(() =>
          access(enteredPath).then(
            () => true,
            () => false,
          ),
        )
        .toBe(true)
      // Keep the fixture producer blocked after it starts: an old prompt must not satisfy readiness.
      await new Promise(resolve => setTimeout(resolve, 1000))
      await writeFile(gatePath, 'release')
    })()
    // Observe an early rejection immediately; the awaited release below still reports it.
    void release.catch(() => undefined)
    await printTerminalLinkFixture(window, nodeId, `${filePath}:12:4\r\n`)
    const point = await terminalLinkCellPoint(window, nodeId, 3, 1)
    await window.mouse.click(point.x, point.y)
    await release
    await expect.poll(firstRow).not.toBe(oldPrompt)
    await expect(
      window.locator('[data-testid="terminal-link-actions"][role="dialog"]'),
    ).toBeVisible()
  } finally {
    await writeFile(gatePath, 'release')
    await release?.catch(() => undefined)
    await electronApp.close()
    await removePathWithRetry(directory)
  }
})
