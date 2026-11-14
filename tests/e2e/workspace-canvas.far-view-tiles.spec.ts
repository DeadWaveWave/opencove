import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { lodOf, readFarTileFace, setZoom } from './workspace-canvas.far-view.helpers'

const TERMINAL = 'far-tiles-terminal'
const NOTE = 'far-tiles-note'
const BOARD = 'far-tiles-board'

/**
 * The Tide prototype's far face (.n-far): what the face's content box allows, capped on screen at
 * a 26px glyph and a 15px title (times the UI font scale).
 */
const expectedFace = (box: { width: number; height: number }, titleCap: number) => ({
  icon: Math.min(26, 0.26 * box.height),
  title: Math.min(titleCap, 0.12 * box.width, 0.22 * box.height),
})

test('far tiles share the frost corner and shrink their face with a tile too small to hold it', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await clearAndSeedWorkspace(
      window,
      [
        { id: TERMINAL, title: 'Build logs', position: { x: 0, y: 0 }, width: 460, height: 300 },
        {
          id: NOTE,
          title: 'Release notes',
          kind: 'note',
          position: { x: 560, y: 0 },
          width: 360,
          height: 300,
          task: { text: 'Release notes' },
        },
        { id: BOARD, title: 'Release board', position: { x: 0, y: 400 }, width: 1400, height: 900 },
      ],
      { settings: { uiTheme: 'dark', canvasFarViewEnabled: true } },
    )
    await setZoom(window, 0.2)
    await expect.poll(() => lodOf(window)).toBe('far')
    const terminalTile = window.getByTestId(`workspace-far-tile-${TERMINAL}`)
    const noteTile = window.getByTestId(`workspace-far-tile-${NOTE}`)
    await expect(noteTile).toContainText('Release notes')

    // The tile is the window's glass: its corner is the one the wall frosts under it, in canvas
    // px like the frost, so the two never show different corners.
    const corner = await terminalTile.evaluate(element => ({
      tile: getComputedStyle(element).borderTopLeftRadius,
      glass: getComputedStyle(element).getPropertyValue('--cove-node-radius').trim(),
    }))
    expect(corner.tile).toBe(corner.glass)

    // Icon and title keep the prototype's screen size (26px glyph, 15px title) while the tile
    // can hold them; in a smaller tile they shrink with it (26% of its height, 12% of its width
    // or 22% of its height) instead of being cut or dropped, so the whole title stays readable
    // as a poster of the window.
    const titleCap = await window.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.fontSize = 'calc(15px * var(--cove-ui-font-scale))'
      document.body.append(probe)
      const size = Number.parseFloat(getComputedStyle(probe).fontSize)
      probe.remove()
      return Math.round(size * 10) / 10
    })
    const boardTile = window.getByTestId(`workspace-far-tile-${BOARD}`)
    const board = await readFarTileFace(boardTile)
    expect({ icon: board.icon, title: board.title }).toEqual({ icon: 26, title: titleCap })
    expect(board.lines).toBe(1)

    for (const zoom of [0.24, 0.2, 0.12, 0.1]) {
      await setZoom(window, zoom)
      for (const tile of [terminalTile, noteTile]) {
        const face = await readFarTileFace(tile)
        const expected = expectedFace(face.box, titleCap)
        expect(expected.title).toBeLessThan(titleCap)
        expect(face.icon).toBeCloseTo(expected.icon, 0)
        expect(face.title).toBeCloseTo(expected.title, 0)
        expect(face.lines).toBeGreaterThanOrEqual(1)
        expect(face.lines).toBeLessThanOrEqual(2)
      }
    }
    await expect(noteTile).toContainText('Release notes')
  } finally {
    await electronApp.close()
  }
})
