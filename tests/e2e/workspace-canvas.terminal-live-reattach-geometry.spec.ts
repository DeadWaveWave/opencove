import { expect, test, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
} from './workspace-canvas.helpers'

const nodeId = 'terminal-live-reattach-geometry'

async function writeTerminalCommand(page: Page, source: string): Promise<void> {
  const terminal = page.locator('.terminal-node').first()
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  await page.keyboard.type(buildNodeEvalCommand(source))
  await page.keyboard.press('Enter')
}

async function readParentPid(page: Page, marker: string): Promise<number> {
  await writeTerminalCommand(
    page,
    `process.stdout.write(${JSON.stringify(marker)} + String(process.ppid) + '\\n')`,
  )
  await expect(page.locator('.terminal-node')).toContainText(marker, { timeout: 10_000 })
  const text = (await page.locator('.terminal-node').textContent()) ?? ''
  const match = text.match(new RegExp(`${marker}(\\d+)`))
  if (!match) {
    throw new Error(`Missing terminal parent pid marker: ${marker}`)
  }
  return Number(match[1])
}

test('a live Desktop terminal reattach commits its measured frame without replacing the PTY', async () => {
  const userDataDir = await createTestUserDataDir()
  await writeFile(
    join(userDataDir, 'home-worker.json'),
    `${JSON.stringify({
      version: 1,
      mode: 'local',
      remote: null,
      webUi: { enabled: false, port: null, exposeOnLan: false, passwordHash: null },
      updatedAt: null,
    })}\n`,
    'utf8',
  )
  const { electronApp, window } = await launchApp({ windowMode: 'offscreen', userDataDir })

  try {
    await clearAndSeedWorkspace(window, [
      {
        id: nodeId,
        title: nodeId,
        position: { x: 120, y: 120 },
        width: 480,
        height: 280,
      },
    ])
    await expect(window.locator('.terminal-node')).toHaveCount(1)
    await expect
      .poll(
        async () =>
          await window.evaluate(
            id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
            nodeId,
          ),
      )
      .toBeTruthy()
    await expect
      .poll(
        async () =>
          await window.evaluate(id => {
            const api = window.__opencoveTerminalSelectionTestApi
            const size = api?.getSize(id) ?? null
            const proposed = api?.getProposedGeometry(id) ?? null
            return Boolean(
              size && proposed && size.cols === proposed.cols && size.rows === proposed.rows,
            )
          }, nodeId),
      )
      .toBe(true)

    const before = await window.evaluate(
      id => ({
        sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
        proposed: window.__opencoveTerminalSelectionTestApi?.getProposedGeometry(id) ?? null,
      }),
      nodeId,
    )
    const parentPid = await readParentPid(window, 'PARENT_BEFORE_')
    const historyMarker = `HISTORY_BEFORE_${Date.now()}`
    await writeTerminalCommand(window, `process.stdout.write('${historyMarker}\\n')`)
    await expect(window.locator('.terminal-node')).toContainText(historyMarker)

    const writeResult = await window.evaluate(async id => {
      const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
      if (!raw) {
        throw new Error('Missing persisted state')
      }
      const state = JSON.parse(raw) as {
        workspaces: Array<{ nodes: Array<{ id: string; width: number; height: number }> }>
      }
      const node = state.workspaces
        .flatMap(workspace => workspace.nodes)
        .find(item => item.id === id)
      if (!node) {
        throw new Error('Missing terminal node')
      }
      node.width = 820
      node.height = 520
      return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
        raw: JSON.stringify(state),
      })
    }, nodeId)
    expect(writeResult.ok).toBe(true)

    await window.reload({ waitUntil: 'domcontentloaded' })
    await expect(window.locator('.terminal-node')).toHaveCount(1)
    await expect
      .poll(
        async () =>
          await window.evaluate(
            id => window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
            nodeId,
          ),
      )
      .toBe(before.sessionId)
    await expect(window.locator('.terminal-node')).toContainText(historyMarker)

    await expect
      .poll(
        async () =>
          await window.evaluate(id => {
            const api = window.__opencoveTerminalSelectionTestApi
            const size = api?.getSize(id) ?? null
            const proposed = api?.getProposedGeometry(id) ?? null
            return size && proposed && size.cols === proposed.cols && size.rows === proposed.rows
          }, nodeId),
      )
      .toBe(true)
    const after = await window.evaluate(
      id => ({
        sessionId: window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id) ?? null,
        size: window.__opencoveTerminalSelectionTestApi?.getSize(id) ?? null,
        proposed: window.__opencoveTerminalSelectionTestApi?.getProposedGeometry(id) ?? null,
      }),
      nodeId,
    )
    expect(after.proposed).not.toEqual(before.proposed)
    expect(after.size).toEqual(after.proposed)
    expect(await readParentPid(window, 'PARENT_AFTER_')).toBe(parentPid)

    const snapshot = await window.evaluate(
      async sessionId =>
        sessionId ? await window.opencoveApi.pty.presentationSnapshot({ sessionId }) : null,
      after.sessionId,
    )
    expect(snapshot).toMatchObject({ cols: after.size?.cols, rows: after.size?.rows })

    if (await window.evaluate(() => window.opencoveApi.meta.platform !== 'win32')) {
      const marker = `STTY_${Date.now()}`
      const terminal = window.locator('.terminal-node').first()
      await terminal.locator('.xterm').click()
      await window.keyboard.type(`printf '${marker} '; stty size`)
      await window.keyboard.press('Enter')
      await expect(terminal).toContainText(`${marker} ${after.size?.rows} ${after.size?.cols}`, {
        timeout: 10_000,
      })
    }
  } finally {
    await electronApp.close()
  }
})
