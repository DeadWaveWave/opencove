import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'
import { wheelToZoom } from './workspace-canvas.zoom.helpers'

test('zooms with one real wheel when a note covers the bottom-right canvas rail', async () => {
  const { electronApp, window } = await launchApp()
  try {
    await (
      await electronApp.browserWindow(window)
    ).evaluate(browserWindow => {
      browserWindow.setContentSize(1440, 900)
    })
    await clearAndSeedWorkspace(
      window,
      [
        {
          id: 'corner-note',
          title: 'Corner note',
          kind: 'note',
          position: { x: 1000, y: 736 },
          width: 420,
          height: 260,
          task: { text: 'This editor owns its wheel input.' },
        },
      ],
      { settings: { canvasInputMode: 'mouse', canvasWheelBehavior: 'zoom' } },
    )
    const cornerHitsEditor = await window.locator('.workspace-canvas').evaluate(canvas => {
      const rect = canvas.getBoundingClientRect()
      return document
        .elementFromPoint(rect.right - 8, rect.bottom - 24)
        ?.matches('.note-node__textarea.nowheel')
    })
    expect(cornerHitsEditor).toBe(true)

    const wheelEvents = await window.evaluateHandle(() => {
      const events: Array<{ trusted: boolean; hitsPane: boolean }> = []
      document.addEventListener(
        'wheel',
        event => {
          events.push({
            trusted: event.isTrusted,
            hitsPane: event.target === document.querySelector('.react-flow__pane'),
          })
        },
        { capture: true },
      )
      return events
    })

    await wheelToZoom(window, 0.5)
    expect(await wheelEvents.jsonValue()).toEqual([{ trusted: true, hitsPane: true }])
  } finally {
    await electronApp.close()
  }
})
