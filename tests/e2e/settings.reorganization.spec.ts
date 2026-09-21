import { expect, test, type Page, type TestInfo } from '@playwright/test'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  seededWorkspaceId,
  selectCoveOption,
} from './workspace-canvas.helpers'
import { PIXEL_EFFECTS_ENABLED, setPixelEffect } from './workspace-canvas.pixel-effects.helpers'

const TERMINAL_ID = 'settings-live-terminal'

async function attachPanel(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(`${name}.png`)
  await page.getByTestId('settings-panel').screenshot({ path, animations: 'disabled' })
  await testInfo.attach(name, {
    path,
    contentType: 'image/png',
  })
}

async function readSavedConfiguration(page: Page) {
  return await page.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const state = raw
      ? (JSON.parse(raw) as {
          settings: Record<string, unknown>
          workspaces: Array<{
            id: string
            worktreesRoot?: string
            environmentVariables?: Record<string, string>
          }>
        })
      : null
    return {
      settings: state?.settings,
      projects: state?.workspaces.map(project => ({
        id: project.id,
        worktreesRoot: project.worktreesRoot,
        environmentVariables: project.environmentVariables,
      })),
    }
  })
}

async function readLiveCanvas(page: Page) {
  return await page.evaluate(() => {
    const api = window.__opencoveTerminalSelectionTestApi
    return {
      nodes: [...document.querySelectorAll<HTMLElement>('.react-flow__node')].map(node => ({
        id: node.dataset.id,
        width: node.clientWidth,
        height: node.clientHeight,
        mask: getComputedStyle(node).maskImage,
      })),
      terminals: (api?.getRegisteredNodeIds() ?? []).sort().map(id => ({
        id,
        session: api?.getRuntimeSessionId(id),
        instance: api?.getRenderMetrics(id)?.instanceId,
        size: api?.getSize(id),
      })),
    }
  })
}

async function printLiveMarker(page: Page) {
  const terminal = page.locator(`[data-id="${TERMINAL_ID}"] .terminal-node`)
  await terminal.locator('.xterm').click()
  const stamp = Date.now().toString(36)
  await page.keyboard.type(
    buildNodeEvalCommand(
      `process.stdout.write(['SETTINGS','LIVE','${stamp}'].join('_')+String.fromCharCode(10))`,
    ),
  )
  await page.keyboard.press('Enter')
  await expect(terminal).toContainText(`SETTINGS_LIVE_${stamp}`)
}

test.describe('Settings organization', () => {
  test.setTimeout(120_000)

  test('separates project scope and opens a provider detail directly from search without changing configuration', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(page, [], {
        settings: { uiTheme: 'pixel', language: 'en', terminalDisplayAutoReferenceEnabled: false },
      })
      const before = await readSavedConfiguration(page)
      await page.getByTestId('app-header-settings').click()
      await expect(page.getByTestId('settings-panel-scope-selector')).toHaveValue('app')
      await expect(page.getByTestId('settings-worktree-root')).toHaveCount(0)
      await selectCoveOption(
        page,
        'settings-panel-scope-selector',
        `workspace:${seededWorkspaceId}`,
      )
      await expect(page.getByTestId('settings-worktree-root')).toHaveCount(1)
      await expect(page.getByTestId('settings-env-var-key-input')).toHaveCount(1)
      await expect(page.getByTestId('settings-section-nav-agent')).toHaveCount(0)
      await selectCoveOption(page, 'settings-panel-scope-selector', 'app')
      await expect(page.getByTestId('settings-worktree-root')).toHaveCount(0)
      await page.getByTestId('settings-section-nav-agent').click()
      await expect(page.getByTestId('settings-agent-configure-codex')).toBeVisible()
      await attachPanel(page, testInfo, 'settings-agent-list')
      const search = page.getByTestId('settings-panel-search')
      await search.fill('codex')
      await page.getByTestId('settings-panel-search-result-agent.codex.models').click()
      const detail = page.getByTestId('settings-agent-detail-codex')
      await expect(detail).toBeVisible()
      await expect(detail.locator('#settings-agent-models-codex')).toBeVisible()
      await expect(page.getByTestId('settings-agent-configure-codex')).toHaveCount(0)
      await expect(search).toHaveValue('')
      await attachPanel(page, testInfo, 'settings-agent-detail')
      await page.getByTestId('settings-agent-configure-done-codex').click()
      await expect(page.getByTestId('settings-agent-configure-codex')).toBeFocused()
      await expect(detail).toHaveCount(0)
      expect(await readSavedConfiguration(page)).toEqual(before)
    } finally {
      await electronApp.close()
    }
  })

  test('previews appearance without creating live sessions and keeps typography and Shell on the Terminal page', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window: page } = await launchApp()
    try {
      await clearAndSeedWorkspace(
        page,
        [
          {
            id: TERMINAL_ID,
            kind: 'terminal',
            title: 'Existing terminal',
            position: { x: 120, y: 120 },
            width: 560,
            height: 340,
          },
        ],
        {
          settings: {
            uiTheme: 'pixel',
            language: 'en',
            ...PIXEL_EFFECTS_ENABLED,
            terminalDisplayAutoReferenceEnabled: false,
            focusNodeOnClick: false,
          },
        },
      )
      await expect(page.locator(`[data-id="${TERMINAL_ID}"] .xterm`)).toBeVisible()
      await printLiveMarker(page)
      const before = await readLiveCanvas(page)
      expect(before.nodes).toHaveLength(1)
      expect(before.terminals).toHaveLength(1)
      expect(before.terminals[0].session).toBeTruthy()
      const xterm = await page.locator(`[data-id="${TERMINAL_ID}"] .xterm`).elementHandle()
      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await attachPanel(page, testInfo, 'settings-theme-gallery')
      const preview = page.getByTestId('settings-pixel-effects-preview')
      await expect(preview).toHaveAttribute('data-background', 'true')
      await expect(preview.locator('.react-flow__node')).toHaveCount(0)
      await expect(page.getByTestId('settings-terminal-font-size')).toHaveCount(0)
      await setPixelEffect(page, 'canvasPixelBackgroundEnabled', false)
      await expect(preview).toHaveAttribute('data-background', 'false')
      const field = preview.locator(
        '.settings-pixel-preview__canvas:not(.settings-pixel-preview__canvas--foreground)',
      )
      await expect(field).toBeVisible()
      await setPixelEffect(page, 'agentWorkingPixelEffectEnabled', false)
      await expect(
        preview.locator(
          '.settings-pixel-preview__canvas:not(.settings-pixel-preview__canvas--foreground)',
        ),
      ).toBeHidden()
      await setPixelEffect(page, 'agentWorkingPixelEffectEnabled', true)
      await expect(field).toBeVisible()
      await setPixelEffect(page, 'canvasPixelBackgroundEnabled', true)
      const replay = page.getByTestId('settings-pixel-effects-replay')
      await replay.click()
      await expect(preview).toHaveAttribute('data-playing', 'true')
      await expect(replay).toBeDisabled()
      expect(await readLiveCanvas(page)).toEqual(before)
      await expect(preview).toHaveAttribute('data-playing', 'false')
      await expect(replay).toBeEnabled()
      await expect(preview.locator('.settings-pixel-preview__node--terminal')).toBeVisible()
      expect(await readLiveCanvas(page)).toEqual(before)
      await attachPanel(page, testInfo, 'settings-appearance-gallery-preview')
      await page.getByTestId('settings-section-nav-terminal').click()
      await expect(
        page.getByRole('heading', { level: 2, name: 'Terminal', exact: true }),
      ).toBeVisible()
      await expect(page.getByTestId('settings-terminal-font-size')).toBeVisible()
      await expect(page.getByTestId('settings-terminal-font-family')).toBeVisible()
      await expect(page.getByTestId('settings-terminal-font-family')).not.toContainText(
        'Loading fonts',
      )
      const profiles = await page.evaluate(() => window.opencoveApi.pty.listProfiles())
      if (profiles.profiles.length > 0) {
        await expect(page.getByTestId('settings-terminal-profile-trigger')).toBeVisible()
      } else {
        await expect(page.getByTestId('settings-terminal-profile-trigger')).toHaveCount(0)
      }
      await expect(page.getByTestId('settings-pixel-effects-preview')).toHaveCount(0)
      await expect(
        page.getByTestId('settings-terminal-calibration-disclosure'),
      ).not.toHaveAttribute('open')
      await attachPanel(page, testInfo, 'settings-terminal-page')
      expect(await readLiveCanvas(page)).toEqual(before)
      expect(await xterm!.evaluate(element => element.isConnected)).toBe(true)
      await page.locator('.settings-panel__close').click()
      await printLiveMarker(page)
      expect(await readLiveCanvas(page)).toEqual(before)
    } finally {
      await electronApp.close()
    }
  })
})
