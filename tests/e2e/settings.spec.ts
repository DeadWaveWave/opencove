import { expect, test } from '@playwright/test'
import { launchApp, selectCoveOption } from './workspace-canvas.helpers'

test.describe('Settings', () => {
  test('persists agent provider and list-based custom model options', async ({
    browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp()

    try {
      void browserName
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
          `Failed to reset workspace state: ${resetResult.reason}: ${resetResult.error.code}${
            resetResult.error.debugMessage ? `: ${resetResult.error.debugMessage}` : ''
          }`,
        )
      }
      await window.reload({ waitUntil: 'domcontentloaded' })

      const settingsButton = window.locator('[data-testid="app-header-settings"]')
      await expect(settingsButton).toBeVisible()
      await settingsButton.click({ noWaitAfter: true })

      const generalNav = window.locator('[data-testid="settings-section-nav-general"]')
      const agentNav = window.locator('[data-testid="settings-section-nav-agent"]')
      const canvasNav = window.locator('[data-testid="settings-section-nav-canvas"]')
      const taskConfigurationNav = window.locator(
        '[data-testid="settings-section-nav-task-configuration"]',
      )
      await expect(generalNav).toBeVisible()
      await expect(agentNav).toBeVisible()
      await expect(canvasNav).toBeVisible()
      await expect(taskConfigurationNav).toBeVisible()

      const languageSelect = window.locator('[data-testid="settings-language"]')
      const languageTrigger = window.locator('[data-testid="settings-language-trigger"]')
      await expect(languageTrigger).toBeVisible()
      await selectCoveOption(window, 'settings-language', 'zh-CN')
      await expect(languageSelect).toHaveValue('zh-CN')
      await expect(window.locator('.settings-panel__header h2')).toHaveText('设置')

      const uiThemeSelect = window.locator('[data-testid="settings-ui-theme"]')
      const uiThemeTrigger = window.locator('[data-testid="settings-ui-theme-trigger"]')
      await expect(uiThemeTrigger).toBeVisible()
      await selectCoveOption(window, 'settings-ui-theme', 'light')
      await expect(uiThemeSelect).toHaveValue('light')
      await expect
        .poll(() =>
          window.evaluate(() => {
            return document.documentElement.dataset.coveTheme ?? null
          }),
        )
        .toBe('light')

      const uiFontSize = window.locator('[data-testid="settings-ui-font-size"]')
      await expect(uiFontSize).toBeVisible()
      await uiFontSize.fill('20')

      const terminalFontSize = window.locator('[data-testid="settings-terminal-font-size"]')
      await expect(terminalFontSize).toBeVisible()
      await terminalFontSize.fill('15')

      const updatePolicy = window.locator('[data-testid="settings-update-policy"]')
      const updatePolicyTrigger = window.locator('[data-testid="settings-update-policy-trigger"]')
      await expect(updatePolicyTrigger).toBeVisible()
      await expect(updatePolicy).toHaveValue('prompt')
      await selectCoveOption(window, 'settings-update-policy', 'auto')
      await expect(updatePolicy).toHaveValue('auto')

      const updateChannel = window.locator('[data-testid="settings-update-channel"]')
      const updateChannelTrigger = window.locator('[data-testid="settings-update-channel-trigger"]')
      await expect(updateChannelTrigger).toBeVisible()
      await expect(updateChannel).toHaveValue('stable')
      await selectCoveOption(window, 'settings-update-channel', 'nightly')
      await expect(updateChannel).toHaveValue('nightly')
      await expect(updatePolicy).toHaveValue('prompt')

      await canvasNav.click()
      const canvasInputMode = window.locator('[data-testid="settings-canvas-input-mode"]')
      const canvasInputModeTrigger = window.locator(
        '[data-testid="settings-canvas-input-mode-trigger"]',
      )
      await expect(canvasInputModeTrigger).toBeVisible()
      await expect(canvasInputMode).toHaveValue('auto')
      await selectCoveOption(window, 'settings-canvas-input-mode', 'trackpad')
      await expect(canvasInputMode).toHaveValue('trackpad')

      const normalizeZoomToggle = window.locator(
        '[data-testid="settings-normalize-zoom-on-terminal-click"]',
      )
      await expect(normalizeZoomToggle).toBeVisible()
      await normalizeZoomToggle.uncheck()

      await agentNav.click()
      const defaultProvider = window.locator('[data-testid="settings-default-provider"]')
      const defaultProviderTrigger = window.locator(
        '[data-testid="settings-default-provider-trigger"]',
      )
      await expect(defaultProviderTrigger).toBeVisible()
      await selectCoveOption(window, 'settings-default-provider', 'codex')
      await expect(defaultProvider).toHaveValue('codex')

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

      const modelOverrideSection = window.locator('#settings-section-model-override')
      await expect(modelOverrideSection).toBeVisible()
      await modelOverrideSection.scrollIntoViewIfNeeded()

      const providerTitle = modelOverrideSection
        .locator('.settings-provider-card__title')
        .filter({ hasText: 'Codex' })
        .first()
      await expect(providerTitle).toBeVisible()

      const providerTitleColor = await providerTitle.evaluate(element => {
        return window.getComputedStyle(element).color
      })

      const rgbMatch = providerTitleColor.match(
        /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([0-9.]+)\s*)?\)/,
      )
      if (!rgbMatch) {
        throw new Error(`Unable to parse provider title color: ${providerTitleColor}`)
      }

      const providerTitleRgb = {
        r: Number.parseInt(rgbMatch[1], 10),
        g: Number.parseInt(rgbMatch[2], 10),
        b: Number.parseInt(rgbMatch[3], 10),
      }

      expect(providerTitleRgb.r).toBeLessThan(120)
      expect(providerTitleRgb.g).toBeLessThan(120)
      expect(providerTitleRgb.b).toBeLessThan(120)

      const screenshotPath = testInfo.outputPath('settings-custom-model-light.png')
      await window.screenshot({ path: screenshotPath })
      await testInfo.attach('settings-custom-model-light', {
        path: screenshotPath,
        contentType: 'image/png',
      })

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
                uiTheme?: string
                terminalFontSize?: number
                uiFontSize?: number
                updatePolicy?: string
                updateChannel?: string
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
          uiTheme: 'light',
          terminalFontSize: 15,
          uiFontSize: 20,
          updatePolicy: 'prompt',
          updateChannel: 'nightly',
        }),
      )

      await expect(window.locator('[data-testid="app-header-settings"]')).toHaveAttribute(
        'aria-label',
        '设置',
      )
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect(window.locator('[data-testid="app-header-settings"]')).toHaveAttribute(
        'aria-label',
        '设置',
      )
      await expect(
        window.evaluate(() => {
          return document.documentElement.dataset.coveTheme
        }),
      ).resolves.toBe('light')
      await expect(window.locator('.workspace-sidebar__agent-provider')).toHaveText('Codex')
      await expect(window.locator('.workspace-sidebar__agent-model')).toHaveText('gpt-5.2-codex')

      const persistedSettings = await readPersistedSettings()

      expect(persistedSettings?.language).toBe('zh-CN')
      expect(persistedSettings?.defaultProvider).toBe('codex')
      expect(persistedSettings?.uiTheme).toBe('light')
      expect(persistedSettings?.customModelEnabledByProvider?.codex).toBe(true)
      expect(persistedSettings?.customModelByProvider?.codex).toBe('gpt-5.2-codex')
      expect(persistedSettings?.customModelOptionsByProvider?.codex).toContain('gpt-5.2-codex')
      expect(persistedSettings?.taskTagOptions).toContain('ops')
      expect(persistedSettings?.taskTagOptions).not.toContain('feature')
      expect(persistedSettings?.normalizeZoomOnTerminalClick).toBe(false)
      expect(persistedSettings?.canvasInputMode).toBe('trackpad')
      expect(persistedSettings?.terminalFontSize).toBe(15)
      expect(persistedSettings?.uiFontSize).toBe(20)
      expect(persistedSettings?.updatePolicy).toBe('prompt')
      expect(persistedSettings?.updateChannel).toBe('nightly')
    } finally {
      await electronApp.close()
    }
  })
})
