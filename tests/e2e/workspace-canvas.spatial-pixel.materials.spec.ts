import { wheelToZoom } from './workspace-canvas.zoom.helpers'
import { PIXEL_EFFECTS_ENABLED } from './workspace-canvas.pixel-effects.helpers'
import { expect, test, type Page, type TestInfo } from '@playwright/test'
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import {
  buildNodeEvalCommand,
  clearAndSeedWorkspace,
  launchApp,
  readCanvasViewport,
  seededWorkspaceId,
  testWorkspacePath,
  viewStateStorageKey,
} from './workspace-canvas.helpers'
import {
  createMaterialFixture,
  MATERIAL_NODE_KINDS,
  MATERIAL_TERMINAL,
  seedMaterialFixture,
} from './workspace-canvas.spatial-pixel.materials.fixture'

async function attachFrame(window: Page, testInfo: TestInfo, name: string) {
  const screenshot = testInfo.outputPath(`${name}.png`)
  await window.screenshot({ path: screenshot, animations: 'allow' })
  await testInfo.attach(name, { path: screenshot, contentType: 'image/png' })
}

async function geometry(window: Page) {
  return await window.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('.react-flow__node'))
      .map(node => ({ id: node.dataset.id, width: node.clientWidth, height: node.clientHeight }))
      .sort((left, right) => (left.id ?? '').localeCompare(right.id ?? '')),
  )
}

async function terminalIdentity(window: Page) {
  return await window.evaluate(id => {
    const api = window.__opencoveTerminalSelectionTestApi
    const node = document.querySelector(
      `[data-id="${id}"] .terminal-node__terminal`,
    ) as HTMLElement | null
    return {
      sessionId: api?.getRuntimeSessionId(id),
      instanceId: api?.getRenderMetrics(id)?.instanceId,
      size: api?.getSize(id),
      body: node ? { width: node.clientWidth, height: node.clientHeight } : null,
    }
  }, MATERIAL_TERMINAL)
}

async function attachTerminalDiagnostics(window: Page, testInfo: TestInfo) {
  // A real pointer interaction activates a cold Agent presentation before reading its metrics.
  await window.locator('[data-id="pixel-material-agent"] .terminal-node__body').click({
    position: { x: 40, y: 40 },
  })
  await expect
    .poll(
      () =>
        window.evaluate(() => {
          const api = window.__opencoveTerminalSelectionTestApi
          return ['pixel-material-terminal', 'pixel-material-agent'].every(id => {
            return Boolean(
              api?.getRuntimeSessionId(id) && api?.getFontOptions(id) && api?.getSize(id),
            )
          })
        }),
      { timeout: 20000 },
    )
    .toBe(true)
  const data = await window.evaluate(async () => {
    const raw = await window.opencoveApi.persistence.readWorkspaceStateRaw()
    const settings = raw
      ? (
          JSON.parse(raw) as {
            settings?: { terminalFontSize?: number; terminalDisplayReference?: unknown }
          }
        ).settings
      : null
    const api = window.__opencoveTerminalSelectionTestApi
    return {
      devicePixelRatio: window.devicePixelRatio,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      terminalFontSize: settings?.terminalFontSize,
      terminalDisplayReference: settings?.terminalDisplayReference,
      terminals: ['pixel-material-terminal', 'pixel-material-agent'].map(id => ({
        id,
        font: api?.getFontOptions(id),
        size: api?.getSize(id),
        metrics: api?.getRenderMetrics(id),
        body: (() => {
          const body = document.querySelector(
            `[data-id="${id}"] .terminal-node__terminal`,
          ) as HTMLElement | null
          return body ? { width: body.clientWidth, height: body.clientHeight } : null
        })(),
      })),
    }
  })
  const diagnosticPath = testInfo.outputPath('terminal-diagnostics.json')
  await writeFile(diagnosticPath, JSON.stringify(data, null, 2))
  await testInfo.attach('pixel-material-terminal-diagnostics', {
    path: diagnosticPath,
    contentType: 'application/json',
  })
  expect(data.terminals.every(terminal => (terminal.font?.fontSize ?? 0) >= 10)).toBe(true)
}

async function runBuildOutput(window: Page) {
  const terminal = window.locator(`[data-id="${MATERIAL_TERMINAL}"] .terminal-node`)
  await terminal.locator('.xterm').click()
  await expect(terminal.locator('.xterm-helper-textarea')).toBeFocused()
  const stamp = Date.now().toString()
  const marker = `MATERIAL_READY_${stamp}`
  const command = buildNodeEvalCommand(
    `process.stdout.write(String.fromCharCode(27)+'[2J'+String.fromCharCode(27)+'[H'+['Glacier workspace', 'Material check: all eight node kinds', 'Working tree ready', ['MATERIAL','READY',${JSON.stringify(stamp)}].join('_')].join(String.fromCharCode(10))+String.fromCharCode(10))`,
  )
  await window.keyboard.type(command)
  await window.keyboard.press('Enter')
  await expect
    .poll(() =>
      window.evaluate(
        async ({ id, value }) => {
          const sessionId = window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(id)
          if (!sessionId) {
            return false
          }
          const screen = await window.opencoveApi.pty.presentationSnapshot({ sessionId })
          return screen.serializedScreen.includes(value)
        },
        { id: MATERIAL_TERMINAL, value: marker },
      ),
    )
    .toBe(true)
}

test.describe('Workspace Canvas - Spatial Pixel Materials', () => {
  test.setTimeout(180_000)

  test('uses one readable material across every node kind and gives Spaces a real worktree identity', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const fixture = await createMaterialFixture()
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
    })
    try {
      const nativeWindow = await electronApp.browserWindow(window)
      await nativeWindow.evaluate(browserWindow => browserWindow.setContentSize(1800, 1200))
      await seedMaterialFixture(window, fixture)
      await attachTerminalDiagnostics(window, testInfo)
      await runBuildOutput(window)
      await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBe(1)
      const before = await geometry(window)
      const identity = await terminalIdentity(window)
      expect(identity.sessionId).toBeTruthy()
      expect(identity.instanceId).toBeTruthy()
      const headers = await window
        .locator(
          ':is(.terminal-node__header,.task-node__header,.note-node__header,.document-node__header,.website-node__header,.role-node__header)',
        )
        .evaluateAll(elements =>
          elements.map(element => ({
            image: getComputedStyle(element).backgroundImage,
            label: element.closest<HTMLElement>('.react-flow__node')?.dataset.coveLabelColor,
          })),
        )
      expect(headers).toHaveLength(7)
      expect(headers.every(header => header.image.includes('linear-gradient'))).toBe(true)
      expect(headers.every(header => header.label === undefined)).toBe(true)
      await Promise.all(
        MATERIAL_NODE_KINDS.map(kind => {
          const frame =
            kind === 'agent'
              ? window.locator(`[data-id="pixel-material-${kind}"] .terminal-node`)
              : window.locator(`[data-id="pixel-material-${kind}"] .${kind}-node`)
          return Promise.all([
            expect(frame).toBeVisible(),
            expect(frame).toHaveCSS('border-top-style', 'solid'),
            expect(frame).toHaveCSS('border-top-width', '1px'),
          ])
        }),
      )
      const terminal = window.locator(`[data-id="${MATERIAL_TERMINAL}"] .terminal-node`)
      const bodyColor = await terminal.locator('.terminal-node__terminal').evaluate(
        element =>
          getComputedStyle(element)
            .backgroundColor.match(/[\d.]+/g)
            ?.map(Number) ?? [],
      )
      expect(bodyColor[2]).toBeGreaterThan(bodyColor[0]! * 1.5)
      expect(Math.max(...bodyColor.slice(0, 3))).toBeLessThan(48)
      const space = window.getByTestId('workspace-space-region-pixel-build-space')
      await expect(space).toHaveCSS('border-top-style', 'solid')
      expect(
        await space.evaluate(element => {
          const border = getComputedStyle(element, '::before')
          return { style: border.borderTopStyle, width: Number.parseFloat(border.borderTopWidth) }
        }),
      ).toEqual({ style: 'solid', width: 1 })
      await expect(window.getByTestId('workspace-space-label-pixel-review-space')).toContainText(
        'Review worktree',
      )
      await attachFrame(window, testInfo, 'pixel-materials-all-node-kinds')

      const note = window.locator('[data-id="pixel-material-note"] .note-node')
      const borderBefore = await note.evaluate(element => getComputedStyle(element).borderTopColor)
      await note
        .getByTestId('note-node-textarea')
        .fill('All nodes share the same material.\nSelection and input remain clear.')
      await expect
        .poll(() => note.evaluate(element => getComputedStyle(element).borderTopColor))
        .not.toBe(borderBefore)
      expect(await geometry(window)).toEqual(before)
      expect(await terminalIdentity(window)).toEqual(identity)
      await attachFrame(window, testInfo, 'pixel-materials-focus-and-space')
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })

  test('keeps material and terminal geometry stable through half, fifth and minimum canvas zoom', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const fixture = await createMaterialFixture()
    const videoDirectory = process.env.OPENCOVE_E2E_PIXEL_PRESENTATION_VIDEO_DIR
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
      ...(videoDirectory
        ? { recordVideo: { dir: videoDirectory, size: { width: 1800, height: 1200 } } }
        : {}),
    })
    const video = window.video()
    try {
      const nativeWindow = await electronApp.browserWindow(window)
      await nativeWindow.evaluate(browserWindow => browserWindow.setContentSize(1800, 1200))
      await seedMaterialFixture(window, fixture)
      await attachTerminalDiagnostics(window, testInfo)
      await runBuildOutput(window)
      const baseline = await geometry(window)
      const identity = await terminalIdentity(window)
      await attachFrame(window, testInfo, 'pixel-materials-zoom-1')
      if (videoDirectory) {
        await window.waitForTimeout(1500)
      }
      const inspectZoom = async (zoom: number) => {
        await wheelToZoom(window, zoom)
        expect(await geometry(window)).toEqual(baseline)
        expect(await terminalIdentity(window)).toEqual(identity)
        await expect(window.getByTestId('workspace-pixel-layer')).toHaveCSS(
          'pointer-events',
          'none',
        )
        await attachFrame(window, testInfo, `pixel-materials-zoom-${zoom}`)
        if (videoDirectory) {
          await window.waitForTimeout(1200)
        }
      }
      await inspectZoom(0.5)
      await inspectZoom(0.2)
      await inspectZoom(0.1)
      await wheelToZoom(window, 1)
      expect(await geometry(window)).toEqual(baseline)
      expect(await terminalIdentity(window)).toEqual(identity)
      await attachFrame(window, testInfo, 'pixel-materials-zoom-return')
    } finally {
      await electronApp.close()
      if (videoDirectory && video) {
        const videoPath = path.join(videoDirectory, 'spatial-pixel-materials.webm')
        await video.saveAs(videoPath)
        await testInfo.attach('spatial-pixel-materials', {
          path: videoPath,
          contentType: 'video/webm',
        })
      }
      await fixture.cleanup()
    }
  })

  test('keeps huge overlapping empty Spaces as faint regions at twenty percent zoom', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const { electronApp, window } = await launchApp()
    try {
      const nativeWindow = await electronApp.browserWindow(window)
      await nativeWindow.evaluate(browserWindow => browserWindow.setContentSize(1800, 1200))
      await clearAndSeedWorkspace(
        window,
        [
          {
            id: 'far-note-1',
            title: 'Working note',
            kind: 'note',
            position: { x: 2000, y: 2600 },
            width: 420,
            height: 260,
            task: { text: 'Context stays with the work.' },
          },
          {
            id: 'far-note-2',
            title: 'Review note',
            kind: 'note',
            position: { x: 3900, y: 3500 },
            width: 420,
            height: 260,
            task: { text: 'A region is part of the canvas.' },
          },
        ],
        {
          settings: {
            uiTheme: 'pixel',
            ...PIXEL_EFFECTS_ENABLED,
            language: 'en',
            isPrimarySidebarCollapsed: true,
            focusNodeOnClick: false,
            githubPullRequestsEnabled: false,
          },
          spaces: [
            {
              id: 'far-main',
              name: 'Space 2',
              directoryPath: testWorkspacePath,
              nodeIds: ['far-note-1', 'far-note-2'],
              pinned: false,
              rect: { x: 0, y: 0, width: 6500, height: 4700 },
            },
            {
              id: 'far-overlap',
              name: 'Space 1',
              directoryPath: testWorkspacePath,
              nodeIds: [],
              pinned: false,
              rect: { x: 3800, y: 80, width: 2500, height: 1500 },
            },
            {
              id: 'far-left',
              name: 'Space 3',
              directoryPath: testWorkspacePath,
              nodeIds: [],
              pinned: false,
              rect: { x: -1900, y: 450, width: 1800, height: 4900 },
            },
            {
              id: 'far-right',
              name: 'Space 4',
              directoryPath: testWorkspacePath,
              nodeIds: [],
              pinned: false,
              rect: { x: 6300, y: 1900, width: 2200, height: 1800 },
            },
          ],
          activeSpaceId: 'far-main',
        },
      )
      await window.evaluate(
        ({ key, id }) => {
          window.localStorage.setItem(
            key,
            JSON.stringify({
              activeWorkspaceId: id,
              workspaces: {
                [id]: {
                  viewport: { x: 180, y: 170, zoom: 0.2 },
                  isMinimapVisible: false,
                  activeSpaceId: 'far-main',
                },
              },
            }),
          )
        },
        { key: viewStateStorageKey, id: seededWorkspaceId },
      )
      await window.reload({ waitUntil: 'domcontentloaded' })
      await expect.poll(async () => (await readCanvasViewport(window)).zoom).toBeCloseTo(0.2, 2)
      const spaces = window.locator('.workspace-space-region')
      await expect(spaces).toHaveCount(4)
      const appearance = await spaces.evaluateAll(elements =>
        elements.map(element => {
          const style = getComputedStyle(element)
          const rect = element.getBoundingClientRect()
          const color = style.backgroundColor.match(/[\d.]+/g)?.map(Number) ?? []
          return {
            background: style.backgroundImage,
            blur: style.backdropFilter,
            shadow: style.boxShadow,
            alpha: color[3] ?? 1,
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
          }
        }),
      )
      expect(appearance.some(space => space.width > 1000 && space.height > 800)).toBe(true)
      expect(
        appearance.every(
          space => space.background === 'none' && space.blur === 'none' && space.shadow === 'none',
        ),
      ).toBe(true)
      expect(Math.max(...appearance.map(space => space.alpha))).toBeLessThan(0.025)
      const main = appearance.find(space => space.width > 1000)!
      expect(
        appearance.some(
          space =>
            space !== main &&
            space.x < main.x + main.width &&
            space.x + space.width > main.x &&
            space.y < main.y + main.height &&
            space.y + space.height > main.y,
        ),
      ).toBe(true)
      await testInfo.attach('pixel-large-regions-metrics', {
        body: JSON.stringify(appearance, null, 2),
        contentType: 'application/json',
      })
      await attachFrame(window, testInfo, 'pixel-huge-overlapping-regions-zoom-0.2')
    } finally {
      await electronApp.close()
    }
  })
})
