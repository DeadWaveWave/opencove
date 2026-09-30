import { chromium, expect, test } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  clearAndSeedWorkspace,
  createTestUserDataDir,
  launchApp,
  removePathWithRetry,
  seededWorkspaceId,
  seedWorkspaceState,
  selectCoveOption,
  testWorkspacePath,
} from './workspace-canvas.helpers'
import { capturePlugins } from './plugins.local.helpers'
import { startWorker, stopWorker } from './worker-client.helpers'
import {
  canvasPluginNode,
  createCommandPlugin,
  expectCommandReady,
  pluginCli,
  pluginCliFailure,
  savedCommandNodes,
  type PluginWindowList,
  type PluginWindowResult,
} from './plugins.commands.helpers'

const settings = {
  language: 'en' as const,
  uiTheme: 'pixel' as const,
  focusNodeOnClick: false,
  canvasInputMode: 'mouse' as const,
  nodeCreationPixelEffectEnabled: false,
  nodeClosePixelEffectEnabled: false,
}

test.describe('Independent plugin CLI and window ownership', () => {
  test('lists windows and runs backend commands before a fresh Worker has any project or UI', async () => {
    const source = await createCommandPlugin('single')
    const userDataDir = await createTestUserDataDir()
    const { child } = await startWorker({ userDataDir })
    try {
      await pluginCli(userDataDir, ['install', source.directory])
      expect(await pluginCli(userDataDir, ['windows', source.id])).toEqual({ windows: [] })
      expect(await pluginCliFailure(userDataDir, ['open', source.id])).toContain('--project')
      expect(await pluginCli(userDataDir, ['run', source.id, 'inspect'])).toMatchObject({
        pluginId: source.id,
        hasWindow: false,
      })
      expect(await pluginCli(userDataDir, ['windows', source.id])).toEqual({ windows: [] })
    } finally {
      await stopWorker(child)
      await removePathWithRetry(source.directory)
      await removePathWithRetry(userDataDir)
    }
  })
  test('runs backend commands without creating a node, exposes skills, and restores a singleton across restart', async ({
    browserName: _browserName,
  }, info) => {
    test.setTimeout(120_000)
    const source = await createCommandPlugin('single')
    const userDataDir = await createTestUserDataDir()
    let { electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false })
    try {
      await page.setViewportSize({ width: 1400, height: 950 })
      await clearAndSeedWorkspace(page, [], { settings })
      await pluginCli(userDataDir, ['install', source.directory])
      expect(
        await pluginCli(userDataDir, ['run', source.id, 'inspect', '--params', '{"value":7}']),
      ).toEqual({
        pluginId: source.id,
        hasWindow: false,
        params: { value: 7 },
      })
      expect(await savedCommandNodes(page, source.id)).toEqual([])
      expect(await pluginCliFailure(userDataDir, ['open', source.id])).toContain('--project')
      expect(
        await pluginCliFailure(userDataDir, [
          'run',
          source.id,
          'set-label',
          '--params',
          '{"label":"No implicit project"}',
        ]),
      ).toContain('--project')
      expect(await savedCommandNodes(page, source.id)).toEqual([])
      const skill = await pluginCli<{ path: string; content: string; installPrompt: string }>(
        userDataDir,
        ['skill', source.id, 'commands'],
      )
      expect(isAbsolute(skill.path)).toBe(true)
      expect(await readFile(skill.path, 'utf8')).toBe(skill.content)
      expect(skill.content).toContain(`opencove plugin windows ${source.id}`)
      expect(skill.installPrompt).toContain('has not installed')

      await page.getByTestId('app-header-settings').click()
      await page.getByTestId('settings-section-nav-plugins').click()
      await page.getByTestId(`settings-plugin-details-${source.id}`).click()
      const commandList = page.getByTestId('settings-plugin-commands')
      await expect(commandList).toContainText('Inspect')
      await expect(commandList).toContainText('Set label')
      await page.getByTestId('settings-plugin-skill-copy-commands').click()
      await expect
        .poll(() => electronApp.evaluate(({ clipboard }) => clipboard.readText()))
        .toBe(skill.installPrompt)
      await commandList.scrollIntoViewIfNeeded()
      await capturePlugins(page, info, 'plugin-agent-tools-pixel')
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel-light')
      await page.getByTestId('settings-section-nav-plugins').click()
      await page.getByTestId(`settings-plugin-details-${source.id}`).click()
      await commandList.scrollIntoViewIfNeeded()
      await capturePlugins(page, info, 'plugin-agent-tools-pixel-light')
      await page.getByTestId('settings-section-nav-appearance').click()
      await selectCoveOption(page, 'settings-ui-theme', 'pixel')
      await page.locator('.settings-panel__close').click()

      const result = await pluginCli<{ nodeId: string; label: string; executions: number }>(
        userDataDir,
        [
          'run',
          source.id,
          'set-label',
          '--project',
          seededWorkspaceId,
          '--params',
          '{"label":"Created by a real command"}',
        ],
      )
      let node = canvasPluginNode(page, result.nodeId)
      await expectCommandReady(node)
      await expect(node.frameLocator('iframe').locator('#label')).toHaveText(result.label)
      expect(result.executions).toBe(1)
      await node.getByTestId('node-collapse').click()
      await expect(node.getByTestId('node-expand')).toBeVisible()
      await pluginCli(userDataDir, [
        'run',
        source.id,
        'set-label',
        '--params',
        '{"label":"Updated while compact"}',
      ])
      await expect(node.frameLocator('iframe').locator('#label')).toHaveText(
        'Updated while compact',
      )
      await expect(node.getByTestId('node-expand')).toBeVisible()
      await expect.poll(async () => (await savedCommandNodes(page, source.id)).length).toBe(1)

      await electronApp.close()
      ;({ electronApp, window: page } = await launchApp({ userDataDir, cleanupUserDataDir: false }))
      await page.setViewportSize({ width: 1400, height: 950 })
      const reopened = await pluginCli<PluginWindowResult>(userDataDir, ['open', source.id])
      expect(reopened.nodeId).toBe(result.nodeId)
      expect(reopened.created).toBe(false)
      node = canvasPluginNode(page, result.nodeId)
      await expectCommandReady(node)
      await expect(node.frameLocator('iframe').locator('#label')).toHaveText(
        'Updated while compact',
      )
      await expect(node.getByTestId(`plugin-${source.id}-close`)).toBeVisible()
      await capturePlugins(page, info, 'plugin-command-restored-singleton')
      await node.getByTestId(`plugin-${source.id}-close`).click()
      await expect(node).toHaveCount(0)
      await expect.poll(async () => (await savedCommandNodes(page, source.id)).length).toBe(0)
      const replacement = await pluginCli<PluginWindowResult>(userDataDir, [
        'open',
        source.id,
        '--project',
        seededWorkspaceId,
      ])
      expect(replacement.created).toBe(true)
      expect(replacement.nodeId).not.toBe(result.nodeId)
      await expectCommandReady(canvasPluginNode(page, replacement.nodeId))
    } finally {
      await electronApp.close()
      await removePathWithRetry(source.directory)
      await removePathWithRetry(userDataDir)
    }
  })

  test('serializes concurrent singleton creation across projects and shares the action-bar entry', async () => {
    test.setTimeout(90_000)
    const source = await createCommandPlugin('single')
    const userDataDir = await createTestUserDataDir()
    const { electronApp, window: page } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
    })
    const secondProjectId = 'command-project-two'
    try {
      await page.setViewportSize({ width: 1400, height: 950 })
      await seedWorkspaceState(page, {
        activeWorkspaceId: seededWorkspaceId,
        workspaces: [
          { id: seededWorkspaceId, name: 'First project', path: testWorkspacePath, nodes: [] },
          { id: secondProjectId, name: 'Second project', path: source.directory, nodes: [] },
        ],
        settings,
      })
      await pluginCli(userDataDir, ['install', source.directory])
      expect(await pluginCliFailure(userDataDir, ['open', source.id])).toContain('--project')
      expect(await savedCommandNodes(page, source.id)).toEqual([])
      const opened = await Promise.all(
        [seededWorkspaceId, secondProjectId].map(projectId =>
          pluginCli<PluginWindowResult>(userDataDir, ['open', source.id, '--project', projectId]),
        ),
      )
      expect(new Set(opened.map(window => window.nodeId)).size).toBe(1)
      expect(opened.filter(window => window.created)).toHaveLength(1)
      await expect
        .poll(() => savedCommandNodes(page, source.id))
        .toEqual([{ nodeId: opened[0].nodeId, projectId: opened[0].projectId }])
      const otherProject =
        opened[0].projectId === seededWorkspaceId ? secondProjectId : seededWorkspaceId
      await page.getByTestId(`workspace-item-${otherProject}`).click()
      await expect(page.getByTestId(`workspace-item-${otherProject}`)).toHaveAttribute(
        'aria-current',
        'page',
      )
      await page.getByTestId(`workspace-canvas-action-bar-new-plugin:${source.id}`).click()
      await expectCommandReady(canvasPluginNode(page, opened[0].nodeId))
      await expect(page.getByTestId(`workspace-item-${opened[0].projectId}`)).toHaveAttribute(
        'aria-current',
        'page',
      )
      expect(await savedCommandNodes(page, source.id)).toEqual([
        { nodeId: opened[0].nodeId, projectId: opened[0].projectId },
      ])
    } finally {
      await electronApp.close()
      await removePathWithRetry(source.directory)
      await removePathWithRetry(userDataDir)
    }
  })

  test('requires node selection for multiple windows and view selection across Desktop and Web UI', async () => {
    test.setTimeout(120_000)
    const source = await createCommandPlugin('multiple')
    const userDataDir = await createTestUserDataDir()
    await writeFile(
      join(userDataDir, 'home-worker.json'),
      JSON.stringify({
        version: 1,
        mode: 'local',
        remote: null,
        webUi: { enabled: true, port: null, exposeOnLan: false, passwordHash: null },
        updatedAt: null,
      }),
    )
    const { electronApp, window: desktop } = await launchApp({
      userDataDir,
      cleanupUserDataDir: false,
    })
    const browser = await chromium.launch({ headless: true })
    try {
      await desktop.setViewportSize({ width: 1450, height: 950 })
      await clearAndSeedWorkspace(desktop, [], { settings })
      await pluginCli(userDataDir, ['install', source.directory])
      const first = await pluginCli<PluginWindowResult>(userDataDir, [
        'open',
        source.id,
        '--project',
        seededWorkspaceId,
      ])
      const desktopNode = canvasPluginNode(desktop, first.nodeId)
      await expectCommandReady(desktopNode)
      expect(
        await pluginCliFailure(userDataDir, [
          'run',
          source.id,
          'set-label',
          '--params',
          '{"label":"Unselected"}',
        ]),
      ).toContain('--node')
      expect(await savedCommandNodes(desktop, source.id)).toHaveLength(1)
      await expect(desktopNode.frameLocator('iframe').locator('#executions')).toHaveText('0')
      await pluginCli(userDataDir, [
        'run',
        source.id,
        'set-label',
        '--node',
        first.nodeId,
        '--params',
        '{"label":"Desktop only"}',
      ])
      await expect(desktopNode.frameLocator('iframe').locator('#label')).toHaveText('Desktop only')

      const beforeWeb = await pluginCli<PluginWindowList>(userDataDir, ['windows', source.id])
      const desktopViewId = beforeWeb.windows[0].views.find(view => view.ready)!.viewId
      const webUiUrl = await desktop.evaluate(() => window.opencoveApi.worker.getWebUiUrl())
      expect(webUiUrl).toBeTruthy()
      const web = await browser.newPage({ viewport: { width: 1450, height: 950 } })
      await web.goto(webUiUrl!, { waitUntil: 'domcontentloaded' })
      const webNode = canvasPluginNode(web, first.nodeId)
      await expectCommandReady(webNode)
      await expect
        .poll(async () => {
          const list = await pluginCli<PluginWindowList>(userDataDir, ['windows', source.id])
          return list.windows[0].views.filter(view => view.ready).length
        })
        .toBe(2)
      expect(
        await pluginCliFailure(userDataDir, [
          'run',
          source.id,
          'set-label',
          '--node',
          first.nodeId,
          '--params',
          '{"label":"Ambiguous"}',
        ]),
      ).toContain('multiple clients')
      await expect(webNode.frameLocator('iframe').locator('#executions')).toHaveText('0')
      await expect(desktopNode.frameLocator('iframe').locator('#executions')).toHaveText('1')
      const list = await pluginCli<PluginWindowList>(userDataDir, ['windows', source.id])
      const webViewId = list.windows[0].views.find(
        view => view.ready && view.viewId !== desktopViewId,
      )!.viewId
      const target = await pluginCli<{ nodeId: string; executions: number }>(userDataDir, [
        'run',
        source.id,
        'set-label',
        '--node',
        first.nodeId,
        '--view',
        webViewId,
        '--params',
        '{"label":"Web document only"}',
      ])
      expect(target.nodeId).toBe(first.nodeId)
      expect(target.executions).toBe(1)
      await expect(webNode.frameLocator('iframe').locator('#label')).toHaveText('Web document only')
      await expect(desktopNode.frameLocator('iframe').locator('#label')).toHaveText('Desktop only')
      await web.close()
      await expect
        .poll(async () => {
          const current = await pluginCli<PluginWindowList>(userDataDir, ['windows', source.id])
          return current.windows[0].views.filter(view => view.ready).length
        })
        .toBe(1)
      const second = await pluginCli<PluginWindowResult>(userDataDir, [
        'open',
        source.id,
        '--project',
        seededWorkspaceId,
      ])
      expect(second.nodeId).not.toBe(first.nodeId)
      await expectCommandReady(canvasPluginNode(desktop, second.nodeId))
      await pluginCli(userDataDir, [
        'run',
        source.id,
        'set-label',
        '--node',
        second.nodeId,
        '--params',
        '{"label":"Second window"}',
      ])
      await expect(
        canvasPluginNode(desktop, second.nodeId).frameLocator('iframe').locator('#label'),
      ).toHaveText('Second window')
      await expect(desktopNode.frameLocator('iframe').locator('#label')).toHaveText('Desktop only')
      expect(await savedCommandNodes(desktop, source.id)).toHaveLength(2)
    } finally {
      await browser.close()
      await electronApp.close()
      await removePathWithRetry(source.directory)
      await removePathWithRetry(userDataDir)
    }
  })
})
