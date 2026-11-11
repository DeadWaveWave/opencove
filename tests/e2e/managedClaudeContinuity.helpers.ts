export { holdPrepare, releasePrepare } from './managedClaudePreparationHold'
import { randomUUID } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expect, type Page } from '@playwright/test'
import { waitForControlSurfaceConnection } from './controlSurfaceConnection.helpers'

export async function syntheticRebind(
  userDataDir: string,
  home: string,
  workspace: string,
  nodeId: string,
  priorId: string,
) {
  const nextId = randomUUID()
  // The artificial provider requires a real test transcript before it will resume B.
  const directory = path.join(
    home,
    '.claude',
    'projects',
    path.resolve(workspace).replace(/[^A-Za-z0-9]/gu, '-'),
  )
  const transcript = await readFile(path.join(directory, `${priorId}.jsonl`), 'utf8')
  await writeFile(path.join(directory, `${nextId}.jsonl`), transcript.replaceAll(priorId, nextId))
  const connection = await waitForControlSurfaceConnection(userDataDir)
  const response = await fetch(`${connection.endpoint}/_test/managed-claude-rebind`, {
    method: 'POST',
    headers: { authorization: `Bearer ${connection.token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId, resumeSessionId: nextId }),
  })
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ status: 'committed', revision: expect.any(Number) })
  return nextId
}

/** Hide the minimap so it cannot cover node controls near the canvas corner. */
async function hideMinimap(page: Page) {
  const minimap = page.locator('.workspace-canvas__minimap')
  if ((await minimap.count()) === 0) {
    return
  }
  const dock = page.locator('.workspace-canvas__minimap-dock')
  const toggle = page.locator('[data-testid="workspace-minimap-toggle"]')
  // The toggle only shows while the dock is hovered; retry hover and click together.
  await expect(async () => {
    await dock.hover()
    await expect(toggle).toBeVisible({ timeout: 2_000 })
    await toggle.click({ timeout: 2_000 })
    await expect(minimap).toHaveCount(0, { timeout: 2_000 })
  }).toPass({ timeout: 20_000 })
}

/** Assert the client's visible Current marker, independently of PTY liveness and test probes. */
export async function expectConversation(page: Page, nodeId: string, resumeSessionId: string) {
  await hideMinimap(page)
  const node = page.locator(`[data-id="${nodeId}"]`)
  await node.getByTestId('terminal-node-session-list').click()
  try {
    const menu = page.getByTestId('terminal-node-session-menu')
    await expect(menu).toBeVisible({ timeout: 30_000 })
    const current = menu.getByTestId(`terminal-node-session-menu-item-${resumeSessionId}`)
    await expect(current).toBeDisabled({ timeout: 30_000 })
    await expect(current.locator('.terminal-node__session-menu-item-badge')).toBeVisible({
      timeout: 30_000,
    })
  } finally {
    await page.keyboard.press('Escape')
  }
}
