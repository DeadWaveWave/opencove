import { expect, test } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'

test.describe('Settings', () => {
  test('persists agent provider and list-based custom model options', async () => {
    const { electronApp, window } = await launchApp()

    try {
      const resetResult = await window.evaluate(async () => {
        return await window.opencoveApi.persistence.writeWorkspaceStateRaw({
          raw: JSON.stringify({
            formatVersion: 1,
            activeWorkspaceId: null,
            workspaces: [],
            settings: {},
          }),
        })
      })

      if (!resetResult.ok) {
        throw new Error(
          `Failed to reset workspace state: ${resetResult.reason}: ${resetResult.message}`,
        )
      }
      await window.reload({ waitUntil: 'domcontentloaded' })

      const settingsButton = window.locator('.workspace-sidebar__settings')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click({ noWaitAfter: true })

      const generalNav = window.locator('[data-testid="settings-section-nav-general"]')
      const canvasNav = window.locator('[data-testid="settings-section-nav-canvas"]')
      await expect(generalNav).toBeVisible()
      await expect(canvasNav).toBeVisible()

      await canvasNav.click()
      await expect(
        window.locator('[data-testid="settings-normalize-zoom-on-terminal-click"]'),
      ).toBeVisible()
      const languageSelect = window.locator('[data-testid="settings-language"]')
      await expect(languageSelect).toBeVisible()
      await languageSelect.selectOption('zh-CN')
      await expect(window.locator('.settings-panel__header h2')).toHaveText('设置')
      const canvasInputMode = window.locator('[data-testid="settings-canvas-input-mode"]')
      await expect(canvasInputMode).toBeVisible()
      await canvasInputMode.selectOption('trackpad')

      const defaultProvider = window.locator('#settings-default-provider')
      await expect(defaultProvider).toBeVisible()
      await defaultProvider.selectOption('codex')

      const taskConfigurationNav = window.locator(
        '[data-testid="settings-section-nav-task-configuration"]',
      )
      await taskConfigurationNav.click()

      const addTaskTagInput = window.locator('[data-testid="settings-task-tag-add-input"]')
      await addTaskTagInput.fill('ops')
      await window.locator('[data-testid="settings-task-tag-add-button"]').click()
      await expect(window.locator('[data-testid="settings-task-tag-list"]')).toContainText('ops')

      await window.locator('[data-testid="settings-task-tag-remove-feature"]').click()
      await expect(window.locator('[data-testid="settings-task-tag-list"]')).not.toContainText(
        'feature',
      )

      await expect(window.locator('#settings-section-task-title')).toHaveCount(0)

      const normalizeZoomToggle = window.locator(
        '[data-testid="settings-normalize-zoom-on-terminal-click"]',
      )
      await normalizeZoomToggle.uncheck()

      const customModelEnabled = window.locator(
        '[data-testid="settings-custom-model-enabled-codex"]',
      )
      await customModelEnabled.check()

      const addInput = window.locator('[data-testid="settings-custom-model-add-input-codex"]')
      await addInput.fill('gpt-5.2-codex')

      const addButton = window.locator('[data-testid="settings-custom-model-add-button-codex"]')
      await addButton.click()

      await expect(window.locator('[data-testid="settings-model-list-codex"]')).toContainText(
        'gpt-5.2-codex',
      )

      await window.locator('.settings-panel__close').click()
      await expect(window.locator('.workspace-sidebar__agent-provider')).toHaveText('Codex')
      await expect(window.locator('.workspace-sidebar__agent-model')).toHaveText('gpt-5.2-codex')

      const readPersistedSettings = async () =>
        await window.evaluate(async () => {
          const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
          if (!raw) {
            return null
          }

          try {
            const parsed = JSON.parse(raw) as {
              settings?: {
                language?: string
                defaultProvider?: string
                customModelEnabledByProvider?: {
                  codex?: boolean
                }
                customModelByProvider?: {
                  codex?: string
                }
                customModelOptionsByProvider?: {
                  codex?: string[]
                }
                taskTagOptions?: string[]
                normalizeZoomOnTerminalClick?: boolean
                canvasInputMode?: string
              }
            }
            return parsed.settings ?? null
          } catch {
            return null
          }
        })

      await expect.poll(readPersistedSettings).toEqual(
        expect.objectContaining({
          language: 'zh-CN',
          defaultProvider: 'codex',
          normalizeZoomOnTerminalClick: false,
          canvasInputMode: 'trackpad',
        }),
      )

      await expect(window.locator('.workspace-sidebar__settings')).toHaveText('设置')
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.workspace-sidebar__settings')).toHaveText('设置')
      await expect(window.locator('.workspace-sidebar__agent-provider')).toHaveText('Codex')
      await expect(window.locator('.workspace-sidebar__agent-model')).toHaveText('gpt-5.2-codex')

      const persistedSettings = await readPersistedSettings()

      expect(persistedSettings?.language).toBe('zh-CN')
      expect(persistedSettings?.defaultProvider).toBe('codex')
      expect(persistedSettings?.customModelEnabledByProvider?.codex).toBe(true)
      expect(persistedSettings?.customModelByProvider?.codex).toBe('gpt-5.2-codex')
      expect(persistedSettings?.customModelOptionsByProvider?.codex).toContain('gpt-5.2-codex')
      expect(persistedSettings?.taskTagOptions).toContain('ops')
      expect(persistedSettings?.taskTagOptions).not.toContain('feature')
      expect(persistedSettings?.normalizeZoomOnTerminalClick).toBe(false)
      expect(persistedSettings?.canvasInputMode).toBe('trackpad')
    } finally {
      await electronApp.close()
    }
  })
})
