import { expectSpaceFrameHeader } from './workspace-canvas.space-caption-border.helpers'
import { expect, test, type Page } from '@playwright/test'
import { launchApp } from './workspace-canvas.helpers'
import { MATERIAL_NODE_KINDS } from './workspace-canvas.spatial-pixel.materials.fixture'
import { selectSpaceLabelColorWithRetry } from './workspace-canvas.label-colors.helpers'
import { wheelToZoom } from './workspace-canvas.zoom.helpers'
import {
  attachIdentityFrame,
  centerIdentityCanvas,
  changeNodeIdentity,
  clearCanvasSelection,
  createIdentityFixture,
  IDENTITY_COLORS,
  nodeSelector,
  persistedLabels,
  printIdentityMarker,
  readNodeIdentity,
  readSpaceIdentity,
  seedIdentityFixture,
  selectIdentityTheme,
  terminalIdentity,
} from './workspace-canvas.color-identity.helpers'

async function geometry(page: Page) {
  return await page.locator('.react-flow__node').evaluateAll(nodes =>
    nodes.map(node => ({
      id: (node as HTMLElement).dataset.id,
      width: (node as HTMLElement).clientWidth,
      height: (node as HTMLElement).clientHeight,
    })),
  )
}

/** The kind channel each window wears in generated families (image windows have no header). */
const KIND_FAMILY: Record<string, string | null> = {
  terminal: 'shell',
  agent: 'ai',
  task: 'plan',
  document: 'knowledge',
  note: 'knowledge',
  role: 'ai',
  website: 'media',
  image: null,
}

/**
 * The header stays clear glass, washed in its kind colour from a layer under its content, with
 * the window's reading plate a separate layer under the whole window (window-plate.css).
 */
function expectHeaderIdentity(node: {
  family: string | null
  headerImage: string | null
  headerWash: string | null
}) {
  expect(node.family).toBe('cove')
  expect(node.headerImage).toBe('none')
  expect(node.headerWash).toContain('linear-gradient')
}

test.describe('Workspace Canvas - Color Identity', () => {
  test.setTimeout(180_000)

  test('identifies all eight node kinds with readable label-colored headers across five themes', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const fixture = await createIdentityFixture()
    const { electronApp, window: page } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
    })
    try {
      await (
        await electronApp.browserWindow(page)
      ).evaluate(window => window.setContentSize(1800, 1200))
      await seedIdentityFixture(page, fixture)
      await clearCanvasSelection(page)
      const originalGeometry = await geometry(page)
      const inspectTheme = async (theme: string) => {
        await selectIdentityTheme(page, theme)
        const appearances = await readNodeIdentity(page)
        await testInfo.attach(`color-identity-${theme}-metrics`, {
          body: JSON.stringify(appearances, null, 2),
          contentType: 'application/json',
        })
        expect(appearances).toHaveLength(8)
        for (const appearance of appearances) {
          expect(appearance.label).toBe(IDENTITY_COLORS[appearance.kind])
          expect(Object.values(appearance.identity)).toEqual([
            appearance.labelColor,
            appearance.labelColor,
            appearance.labelColor,
          ])
          // The label is a short solid flag; the kind colours the tile.
          expect(appearance.ribbonImage).toBe('none')
          expect(appearance.ribbonWidth).toBe(28)
          expect(appearance.ribbonIsLabelColor).toBe(true)
          expect(appearance.tileKind).toBe(KIND_FAMILY[appearance.kind])
          expect(appearance.headerKind).toBe(KIND_FAMILY[appearance.kind])
          expect(appearance.ribbonHeight).toBe(2)
          expect(appearance.borderWidth).toBe('1px')
          // Window headers put the kind icon on a 20px tile; image has no header.
          const tiled = appearance.kind !== 'image'
          expect(appearance.icon).toMatchObject({
            kind: appearance.kind,
            glyph: appearance.kind === 'agent' ? null : appearance.kind,
            provider: appearance.kind === 'agent' ? 'codex' : null,
            fill: 'currentColor',
            shapeRendering: appearance.kind === 'agent' ? null : 'crispEdges',
            width: tiled ? 12 : 16,
            tile: tiled ? 20 : null,
            pointer: 'none',
            hidden: 'true',
            focusable: 'false',
          })
          if (appearance.kind === 'agent') {
            expect(appearance.icon?.color).toEqual(appearance.aiGlyphColor)
          }
          if (appearance.kind !== 'image') {
            expectHeaderIdentity(appearance)
            expect(
              appearance.contrast,
              `${theme}/${appearance.kind} title contrast`,
            ).toBeGreaterThanOrEqual(4.5)
          }
        }
        expect(await geometry(page)).toEqual(originalGeometry)
        await attachIdentityFrame(page, testInfo, `color-identity-${theme}`)
      }
      await inspectTheme('dark')
      await inspectTheme('light')
      await expect(page.locator(`${nodeSelector('image')} .image-node__header`)).toHaveCount(0)
      await expect(page.locator(`${nodeSelector('image')} .image-node`)).toHaveAttribute(
        'data-node-drag-handle',
        'true',
      )
      await expect(
        page.locator(`${nodeSelector('agent')} .terminal-node__title-prefix`),
      ).toHaveCount(0)
      const imageDragSurface = await page.locator(nodeSelector('image')).evaluate(wrapper => {
        const canvas = wrapper.closest<HTMLElement>('.workspace-canvas')!
        const frame = wrapper.querySelector<HTMLElement>('.image-node')!
        const selected = wrapper.classList.contains('selected')
        const dragging = wrapper.classList.contains('dragging')
        const previousMode = canvas.getAttribute('data-cove-drag-surface-selection-mode')
        try {
          wrapper.classList.add('selected')
          canvas.setAttribute('data-cove-drag-surface-selection-mode', 'true')
          const drag = getComputedStyle(frame, '::after')
          const stripe = getComputedStyle(frame, '::before')
          const selectionBorder = getComputedStyle(frame).borderTopColor
          const dragHeight = Number.parseFloat(drag.height)
          const dragPointer = drag.pointerEvents
          wrapper.classList.remove('selected')
          wrapper.classList.add('dragging')
          return {
            dragHeight,
            frameHeight: frame.clientHeight,
            dragPointer,
            stripePointer: stripe.pointerEvents,
            selectionBorder,
            draggingBorder: getComputedStyle(frame).borderTopColor,
          }
        } finally {
          wrapper.classList.toggle('selected', selected)
          wrapper.classList.toggle('dragging', dragging)
          if (previousMode === null) {
            canvas.removeAttribute('data-cove-drag-surface-selection-mode')
          } else {
            canvas.setAttribute('data-cove-drag-surface-selection-mode', previousMode)
          }
        }
      })
      expect(imageDragSurface.dragHeight).toBeGreaterThanOrEqual(imageDragSurface.frameHeight - 2)
      expect(imageDragSurface.dragPointer).toBe('auto')
      expect(imageDragSurface.stripePointer).toBe('none')
      expect(imageDragSurface.draggingBorder).toBe(imageDragSurface.selectionBorder)
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })

  test('restores theme decoration after clearing labels without marking nodes or recreating terminal and Monaco', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const fixture = await createIdentityFixture()
    const { electronApp, window: page } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
    })
    try {
      await (
        await electronApp.browserWindow(page)
      ).evaluate(window => window.setContentSize(1800, 1200))
      await seedIdentityFixture(page, fixture)
      await printIdentityMarker(page)
      const terminalBefore = await terminalIdentity(page)
      expect(terminalBefore.sessionId).toBeTruthy()
      expect(terminalBefore.instanceId).toBeTruthy()
      const monaco = await page
        .locator(`${nodeSelector('document')} .monaco-editor`)
        .elementHandle()
      const xterm = await page.locator(`${nodeSelector('terminal')} .xterm`).elementHandle()
      expect(monaco).not.toBeNull()
      expect(xterm).not.toBeNull()
      const before = await readNodeIdentity(page)
      await changeNodeIdentity(page, 'terminal', 'purple')
      await changeNodeIdentity(page, 'document', 'orange')
      const changed = await readNodeIdentity(page)
      expect(changed.map(node => node.body)).toEqual(before.map(node => node.body))
      // A label recolours the frame and its flag; the header keeps its kind wash.
      for (const kind of ['terminal', 'document']) {
        const [was, now] = [before, changed].map(nodes => nodes.find(node => node.kind === kind)!)
        expect(now.border).not.toBe(was.border)
        expect(now.ribbonIsLabelColor).toBe(true)
        expect(now.headerWash).toBe(was.headerWash)
      }
      await changeNodeIdentity(page, 'terminal', 'none')
      await changeNodeIdentity(page, 'document', 'none')
      const cleared = await readNodeIdentity(page)
      expect(cleared.map(node => node.body)).toEqual(before.map(node => node.body))
      await Promise.all(
        ['terminal', 'document'].map(async kind => {
          await expect(page.locator(nodeSelector(kind))).not.toHaveAttribute(
            'data-cove-label-color',
          )
          const clearedNode = cleared.find(node => node.kind === kind)!
          expectHeaderIdentity(clearedNode)
          expect(clearedNode.ribbonWidth).toBe(0)
        }),
      )
      const palettes = new Set<string>()
      const inspectDefaultTheme = async (theme: string) => {
        await selectIdentityTheme(page, theme)
        const defaults = (await readNodeIdentity(page)).filter(node =>
          ['terminal', 'document'].includes(node.kind),
        )
        for (const node of defaults) {
          expect(node.label).toBeNull()
          expect(Object.values(node.identity)).toEqual(node.themePalette)
          expectHeaderIdentity(node)
          // Unlabeled windows have no flag and a neutral frame.
          expect(node.ribbonWidth).toBe(0)
          expect(
            node.contrast,
            `${theme}/${node.kind} default title contrast`,
          ).toBeGreaterThanOrEqual(4.5)
        }
        palettes.add(defaults[0].identity.color)
        await testInfo.attach(`color-identity-default-${theme}-metrics`, {
          body: JSON.stringify(defaults, null, 2),
          contentType: 'application/json',
        })
        await attachIdentityFrame(page, testInfo, `color-identity-default-${theme}`)
      }
      await inspectDefaultTheme('dark')
      await inspectDefaultTheme('light')
      expect(palettes.size).toBe(2)
      await selectIdentityTheme(page, 'dark')
      const defaultTerminal = (await readNodeIdentity(page)).find(node => node.kind === 'terminal')!
      await changeNodeIdentity(page, 'terminal', 'purple')
      // The label raises its flag; clearing it lowers the flag and leaves the kind wash.
      expect(
        (await readNodeIdentity(page)).find(node => node.kind === 'terminal')?.ribbonWidth,
      ).toBe(28)
      await changeNodeIdentity(page, 'terminal', 'none')
      const restored = (await readNodeIdentity(page)).find(node => node.kind === 'terminal')!
      expect(restored.ribbonWidth).toBe(defaultTerminal.ribbonWidth)
      expect(restored.headerWash).toBe(defaultTerminal.headerWash)
      await page.locator(`${nodeSelector('terminal')} .xterm`).click()
      await expect(page.locator(`${nodeSelector('terminal')} .xterm-helper-textarea`)).toBeFocused()
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
      await expect(page.locator('.workspace-selection-hint')).toHaveCount(0)
      await expect
        .poll(
          async () => (await readNodeIdentity(page)).find(node => node.kind === 'terminal')?.border,
        )
        .not.toBe(defaultTerminal.border)
      const focused = (await readNodeIdentity(page)).find(node => node.kind === 'terminal')!
      expect(focused.label).toBeNull()
      expect(focused.ribbonWidth).toBe(defaultTerminal.ribbonWidth)
      expect(focused.border).not.toBe(defaultTerminal.border)
      expect(focused.body).toEqual(defaultTerminal.body)
      await clearCanvasSelection(page)
      await expect
        .poll(() => persistedLabels(page))
        .toMatchObject({
          'pixel-material-terminal': 'none',
          'pixel-material-document': 'none',
        })
      expect(await terminalIdentity(page)).toEqual(terminalBefore)
      expect(await monaco!.evaluate(element => element.isConnected)).toBe(true)
      expect(await xterm!.evaluate(element => element.isConnected)).toBe(true)
      await printIdentityMarker(page)
      expect(await terminalIdentity(page)).toEqual(terminalBefore)
      await attachIdentityFrame(page, testInfo, 'color-identity-labels-cleared')
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })

  test('keeps Space tint and branch labels bounded across zoom while input focus remains independent', async ({
    browserName,
  }, testInfo) => {
    void browserName
    const fixture = await createIdentityFixture()
    const { electronApp, window: page } = await launchApp({
      env: { OPENCOVE_TEST_WORKSPACE: fixture.repo },
    })
    try {
      await (
        await electronApp.browserWindow(page)
      ).evaluate(window => window.setContentSize(1800, 1200))
      await seedIdentityFixture(page, fixture)
      await selectSpaceLabelColorWithRetry(page, {
        spaceId: 'pixel-build-space',
        color: 'red',
        attempts: 1,
        verification: 'region',
      })
      await clearCanvasSelection(page)
      const inspectZoom = async (zoom: number) => {
        await wheelToZoom(page, zoom)
        await expectSpaceFrameHeader(page, zoom === 0.2 ? 'far' : 'near')
        const spaces = await readSpaceIdentity(page)
        await testInfo.attach(`color-identity-space-${zoom}-metrics`, {
          body: JSON.stringify(spaces, null, 2),
          contentType: 'application/json',
        })
        expect(spaces).toHaveLength(2)
        for (const space of spaces) {
          expect(space.background).toBe('none')
          expect(space.blur).toBe('none')
          expect(space.shadow).toBe('none')
          // Cove keeps the region neutral at every zoom, one faint ink wash inside a neutral
          // contour, so a Space never reads as a panel. Its colour is the four corner brackets.
          expect(space.fill.alpha).toBeCloseTo(0.02, 3)
          expect(space.bracket).toEqual(space.identityPaint)
          expect(space.edge.color.rgb).not.toEqual(space.bracket.rgb)
          if (zoom === 0.2) {
            expect(space.labelScreenFont).toBeGreaterThanOrEqual(8)
          }
          expect(space.edge.width * zoom).toBeGreaterThanOrEqual(0.65)
          expect(space.edge.width * zoom).toBeLessThanOrEqual(1.1)
          for (const group of space.groups) {
            // Far names share one scale and may span 300 screen pixels even in a narrow Space.
            const farCaption = zoom === 0.2 && group.side === 'left'
            const widthBudget = farCaption
              ? Math.max(space.rect.width, 300)
              : space.rect.width * 0.5
            const rightBound = farCaption
              ? Math.max(space.rect.x + space.rect.width, group.left + 300)
              : space.rect.x + space.rect.width
            expect(group.width).toBeLessThanOrEqual(widthBudget + 1)
            expect(group.left).toBeGreaterThanOrEqual(space.rect.x - 1)
            expect(group.right).toBeLessThanOrEqual(rightBound + 1)
          }
        }
        const review = spaces.find(space => space.id === 'pixel-review-space')!
        expect(review.branch).toMatchObject({
          kind: 'branch',
          value: 'pixel/review',
          icon: true,
          shadow: 'none',
        })
        expect(review.branch?.fill.alpha).toBe(0)
        const restore = zoom < 1 ? await centerIdentityCanvas(page) : async () => undefined
        try {
          if (zoom === 0.2) {
            const label = page.getByTestId('workspace-space-label-pixel-build-space')
            const files = page.getByTestId('workspace-space-files-pixel-build-space')
            const menu = page.getByTestId('workspace-space-menu-pixel-build-space')
            await label.focus()
            await page.keyboard.press('Tab')
            await expect(files).toBeFocused()
            await expect(files).toHaveCSS('opacity', '1')
            await expectSpaceFrameHeader(page, 'far')
            await page.keyboard.press('Tab')
            await expect(menu).toBeFocused()
            await expect(menu).toHaveCSS('opacity', '1')
            await expectSpaceFrameHeader(page, 'far')
            await menu.evaluate(element => (element as HTMLElement).blur())
            await label.hover()
            await expect(files).toHaveCSS('pointer-events', 'auto')
            await menu.hover()
            await expect(menu).toHaveCSS('opacity', '1')
            await page.mouse.move(320, 44)
          }
          await attachIdentityFrame(page, testInfo, `color-identity-space-zoom-${zoom}`)
        } finally {
          await restore()
        }
      }
      await inspectZoom(1)
      await inspectZoom(0.5)
      await inspectZoom(0.2)
      await wheelToZoom(page, 1)
      await selectSpaceLabelColorWithRetry(page, {
        spaceId: 'pixel-build-space',
        color: 'none',
        attempts: 1,
        verification: 'region',
      })
      await clearCanvasSelection(page)
      const clearedSpace = (await readSpaceIdentity(page)).find(
        space => space.id === 'pixel-build-space',
      )!
      expect(clearedSpace.label).toBeNull()
      expect(clearedSpace.identityColor).toBe(clearedSpace.defaultIdentityColor)
      const beforeFocus = await readNodeIdentity(page)
      expect(beforeFocus.map(node => node.label)).toEqual(
        MATERIAL_NODE_KINDS.map(kind => IDENTITY_COLORS[kind]),
      )
      const note = page.locator(nodeSelector('note')).getByTestId('note-node-textarea')
      await note.click({ position: { x: 32, y: 32 } })
      await page.keyboard.insertText(' Independent focus.')
      await expect(note).toBeFocused()
      const focused = (await readNodeIdentity(page)).find(node => node.kind === 'note')!
      const idle = beforeFocus.find(node => node.kind === 'note')!
      expect(focused.label).toBe(idle.label)
      expect(focused.ribbonImage).toBe(idle.ribbonImage)
      expect(focused.border).not.toBe(idle.border)
      expect(focused.body).toEqual(idle.body)
      await attachIdentityFrame(page, testInfo, 'color-identity-input-focus')
    } finally {
      await electronApp.close()
      await fixture.cleanup()
    }
  })
})
