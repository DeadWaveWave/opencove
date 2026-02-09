import { expect, test, _electron as electron } from '@playwright/test'
import path from 'path'

const electronAppPath = path.resolve(__dirname, '../../')
const storageKey = 'cove:m0:workspace-state'

test.describe('Settings', () => {
  test('persists agent provider and list-based custom model options', async () => {
    const electronApp = await electron.launch({
      args: [electronAppPath],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        COVE_TEST_WORKSPACE: path.resolve(__dirname, '../../'),
      },
    })

    const window = await electronApp.firstWindow()

    try {
      await window.waitForLoadState('domcontentloaded')
      await window.evaluate(key => {
        window.localStorage.removeItem(key)
      }, storageKey)
      await window.reload({ waitUntil: 'domcontentloaded' })

      const settingsButton = window.locator('.workspace-sidebar__settings')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click()

      const generalNav = window.locator('[data-testid="settings-section-nav-general"]')
      const canvasNav = window.locator('[data-testid="settings-section-nav-canvas"]')
      await expect(generalNav).toBeVisible()
      await expect(canvasNav).toBeVisible()

      await canvasNav.click()
      await expect(
        window.locator('[data-testid="settings-normalize-zoom-on-terminal-click"]'),
      ).toBeVisible()

      const defaultProvider = window.locator('#settings-default-provider')
      await expect(defaultProvider).toBeVisible()
      await defaultProvider.selectOption('codex')

      const taskTitleProvider = window.locator('[data-testid="settings-task-title-provider"]')
      await taskTitleProvider.selectOption('codex')

      const taskTitleModel = window.locator('[data-testid="settings-task-title-model"]')
      await taskTitleModel.fill('gpt-5.2-codex')

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

      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('.workspace-sidebar__agent-provider')).toHaveText('Codex')
      await expect(window.locator('.workspace-sidebar__agent-model')).toHaveText('gpt-5.2-codex')

      const persistedSettings = await window.evaluate(key => {
        const raw = window.localStorage.getItem(key)
        if (!raw) {
          return null
        }

        const parsed = JSON.parse(raw) as {
          settings?: {
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
            taskTitleProvider?: string
            taskTitleModel?: string
            normalizeZoomOnTerminalClick?: boolean
          }
        }

        return parsed.settings ?? null
      }, storageKey)

      expect(persistedSettings?.defaultProvider).toBe('codex')
      expect(persistedSettings?.customModelEnabledByProvider?.codex).toBe(true)
      expect(persistedSettings?.customModelByProvider?.codex).toBe('gpt-5.2-codex')
      expect(persistedSettings?.customModelOptionsByProvider?.codex).toContain('gpt-5.2-codex')
      expect(persistedSettings?.taskTitleProvider).toBe('codex')
      expect(persistedSettings?.taskTitleModel).toBe('gpt-5.2-codex')
      expect(persistedSettings?.normalizeZoomOnTerminalClick).toBe(false)
    } finally {
      await electronApp.close()
    }
  })
})
