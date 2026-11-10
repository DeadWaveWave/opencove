import { expect, type Page } from '@playwright/test'
import type { CreateNodeResult } from '../../src/shared/contracts/dto/nodeControl'

export async function createTerminalInSpace(page: Page, parentId: string) {
  const created = await page.evaluate(
    async payload => {
      return window.opencoveApi.controlSurface.invoke<CreateNodeResult>({
        kind: 'command',
        id: 'node.create',
        payload: {
          kind: 'terminal',
          space: { kind: 'spaceId', spaceId: payload.parentId },
          title: 'Space organizer',
          frame: { x: 600, y: 120, width: 760, height: 540 },
          data: { shell: payload.shell },
        },
      })
    },
    { parentId, shell: process.platform === 'win32' ? 'powershell.exe' : '/bin/sh' },
  )
  if (!created.node.sessionId) {
    throw new Error('Created terminal has no session ID')
  }
  const binding = { nodeId: created.node.id, sessionId: created.node.sessionId }
  await page.evaluate(async nodeId => {
    await window.opencoveApi.controlSurface.invoke({
      kind: 'command',
      id: 'canvas.focus',
      payload: { target: { kind: 'node', nodeId } },
    })
  }, binding.nodeId)
  await expect(
    page.locator(`[data-id="${binding.nodeId}"] .terminal-node__terminal`),
  ).toHaveAttribute('aria-busy', 'false', { timeout: 20_000 })
  return binding
}

export async function focusSpace(page: Page, spaceId: string) {
  // Worker persistence can precede the renderer's debounced sync projection.
  await expect(page.getByTestId(`workspace-space-region-${spaceId}`)).toBeAttached()
  await page.evaluate(async id => {
    await window.opencoveApi.controlSurface.invoke({
      kind: 'command',
      id: 'canvas.focus',
      payload: { target: { kind: 'space', locator: { kind: 'spaceId', spaceId: id } } },
    })
  }, spaceId)
  await expect(page.getByTestId(`workspace-space-region-${spaceId}`)).toBeInViewport({
    timeout: 15_000,
  })
}
