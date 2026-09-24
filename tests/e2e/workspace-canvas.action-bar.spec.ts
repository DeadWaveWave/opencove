import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

test.describe('workspace canvas action bar', () => {
  test('exposes the common canvas creation actions without the legacy new badge', async () => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [])
      await expect(window.getByTestId('workspace-canvas-action-bar')).toBeVisible()
      await expect(window.getByTestId('workspace-canvas-action-bar-new-agent')).toBeVisible()
      await expect(window.getByTestId('workspace-canvas-action-bar-new-terminal')).toBeVisible()
      await expect(window.getByTestId('workspace-canvas-action-bar-new-note')).toBeVisible()
      await expect(window.getByTestId('workspace-canvas-action-bar-new-task')).toBeVisible()
      await expect(window.getByTestId('workspace-canvas-action-bar-new-website')).toBeVisible()
      await expect(window.getByTestId('workspace-canvas-action-bar-new-space')).toBeVisible()
      await expect(window.getByText('NEW', { exact: true })).toHaveCount(0)
      await expect(window.locator('.workspace-canvas__action-bar-grip')).toHaveCount(0)
    } finally {
      await electronApp.close()
    }
  })

  test('creates a note at the viewport center when clicked', async () => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [])
      const canvas = window.locator('.workspace-canvas')
      const action = window.getByTestId('workspace-canvas-action-bar-new-note')
      await expect(action).toBeVisible()
      const before = await window.locator('.react-flow__node:has(.note-node)').count()

      await action.click()

      await expect(window.locator('.react-flow__node:has(.note-node)')).toHaveCount(before + 1)
      const canvasBox = await canvas.boundingBox()
      const noteBox = await window.locator('.react-flow__node:has(.note-node)').last().boundingBox()
      expect(canvasBox).not.toBeNull()
      expect(noteBox).not.toBeNull()
      expect(
        Math.abs(noteBox!.x + noteBox!.width / 2 - (canvasBox!.x + canvasBox!.width / 2)),
      ).toBeLessThan(180)
      expect(
        Math.abs(noteBox!.y + noteBox!.height / 2 - (canvasBox!.y + canvasBox!.height / 2)),
      ).toBeLessThan(180)
    } finally {
      await electronApp.close()
    }
  })

  test('creates a note at the pointer release point when dragged from the bar', async () => {
    const { electronApp, window } = await launchApp()
    try {
      await clearAndSeedWorkspace(window, [])
      const action = window.getByTestId('workspace-canvas-action-bar-new-note')
      const canvas = window.locator('.workspace-canvas')
      const canvasBox = await canvas.boundingBox()
      expect(canvasBox).not.toBeNull()
      const target = {
        x: canvasBox!.x + canvasBox!.width * 0.6,
        y: canvasBox!.y + canvasBox!.height * 0.6,
      }
      const actionBox = await action.boundingBox()
      expect(actionBox).not.toBeNull()
      const before = await window.locator('.react-flow__node:has(.note-node)').count()

      await window.mouse.move(
        actionBox!.x + actionBox!.width / 2,
        actionBox!.y + actionBox!.height / 2,
      )
      await window.mouse.down()
      await window.mouse.move(target.x, target.y, { steps: 8 })
      await window.mouse.up()

      const created = window.locator('.react-flow__node:has(.note-node)').last()
      await expect(window.locator('.react-flow__node:has(.note-node)')).toHaveCount(before + 1)
      const createdBox = await created.boundingBox()
      expect(createdBox).not.toBeNull()
      expect(Math.abs(createdBox!.x + createdBox!.width / 2 - target.x)).toBeLessThan(180)
      expect(Math.abs(createdBox!.y + createdBox!.height / 2 - target.y)).toBeLessThan(180)
    } finally {
      await electronApp.close()
    }
  })
})
