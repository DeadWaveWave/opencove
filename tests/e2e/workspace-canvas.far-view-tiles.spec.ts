import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { lodOf, readFarTileFace, setZoom } from './workspace-canvas.far-view.helpers'

const TERMINAL = 'far-tiles-terminal'
const NOTE = 'far-tiles-note'

test('far tiles share the frost corner and keep their face one size on screen', async () => {
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

    // Icon and title keep one size on screen at every far zoom: the 18px glyph and the secondary
    // font size (which follows the UI font scale). What a smaller tile cannot hold is dropped,
    // never shrunk: the second title line, then the icon, then the title.
    const secondary = await window.evaluate(() => {
      const probe = document.createElement('div')
      probe.style.fontSize = 'var(--cove-font-size-secondary)'
      document.body.append(probe)
      const size = Number.parseFloat(getComputedStyle(probe).fontSize)
      probe.remove()
      return Math.round(size * 10) / 10
    })
    expect(await readFarTileFace(terminalTile)).toEqual({ icon: 18, title: secondary, lines: 1 })
    expect(await readFarTileFace(noteTile)).toEqual({ icon: 18, title: secondary, lines: 1 })
    await setZoom(window, 0.24)
    expect(await readFarTileFace(noteTile)).toEqual({ icon: 18, title: secondary, lines: 2 })
    await setZoom(window, 0.12)
    expect(await readFarTileFace(terminalTile)).toEqual({ icon: null, title: secondary, lines: 1 })
    await setZoom(window, 0.1)
    expect(await readFarTileFace(noteTile)).toEqual({ icon: 18, title: null, lines: 0 })
  } finally {
    await electronApp.close()
  }
})
