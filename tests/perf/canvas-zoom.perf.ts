import { expect, test, type Page } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { clearAndSeedWorkspace, launchApp } from '../e2e/workspace-canvas.helpers'

/**
 * The P0 stress scene: 100 windows, 20 of them terminals printing about 15 lines a second, zoomed
 * 1 → 0.12 → 1 three times at display rate, with far view on and off. Reports frame intervals,
 * long animation frames and window commits (the phase 4.3 probe).
 */
const COLUMNS = 10
const TERMINALS = 20
const WINDOWS = 100

function scene() {
  return Array.from({ length: WINDOWS }, (_, index) => {
    const position = { x: (index % COLUMNS) * 520, y: Math.floor(index / COLUMNS) * 360 }
    if (index < TERMINALS) {
      return {
        id: `perf-terminal-${index}`,
        title: `Terminal ${index}`,
        position,
        width: 460,
        height: 300,
      }
    }
    const kind = index % 3 === 0 ? ('task' as const) : ('note' as const)
    return {
      id: `perf-${kind}-${index}`,
      title: `${kind} ${index}`,
      kind,
      position,
      width: 460,
      height: 300,
      task:
        kind === 'task'
          ? { requirement: `Task ${index}`, status: 'todo', priority: 'medium', tags: [] }
          : { text: `Note ${index}\n${'Lorem ipsum dolor sit amet. '.repeat(8)}` },
    }
  })
}

async function startOutput(window: Page) {
  await expect
    .poll(() =>
      window.evaluate(
        count =>
          Array.from({ length: count }, (_, index) =>
            window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(
              `perf-terminal-${index}`,
            ),
          ).filter(Boolean).length,
        TERMINALS,
      ),
    )
    .toBe(TERMINALS)
  await window.evaluate(async count => {
    for (let index = 0; index < count; index += 1) {
      const sessionId = window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(
        `perf-terminal-${index}`,
      )
      if (sessionId) {
        await window.opencoveApi.pty.write({
          sessionId,
          data: 'while :; do echo "tick $RANDOM $RANDOM $RANDOM"; sleep 0.066; done\r',
        })
      }
    }
  }, TERMINALS)
}

/** Sweeps the zoom once per display frame and measures the frames the sweep produced. */
async function sweep(window: Page) {
  return await window.evaluate(async () => {
    const api = window.__opencoveWorkspaceCanvasTestApi!
    api.resetWindowCommitCounts()
    const longFrames: number[] = []
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        longFrames.push(entry.duration)
      }
    })
    try {
      observer.observe({ type: 'long-animation-frame', buffered: false })
    } catch {
      /* Not every runtime reports long animation frames. */
    }
    const legs = [
      [1, 0.12],
      [0.12, 1],
    ] as const
    const steps = 90
    const intervals: number[] = []
    let last = performance.now()
    for (let round = 0; round < 3; round += 1) {
      for (const [from, to] of legs) {
        for (let step = 1; step <= steps; step += 1) {
          // Geometric steps feel even, like a wheel or pinch gesture.
          const zoom = from * Math.pow(to / from, step / steps)
          await new Promise<void>(resolve =>
            requestAnimationFrame(() => {
              void api.setZoom(zoom)
              resolve()
            }),
          )
          const now = performance.now()
          intervals.push(now - last)
          last = now
        }
      }
    }
    observer.disconnect()
    const sorted = [...intervals].sort((a, b) => a - b)
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!
    const mean = intervals.reduce((sum, value) => sum + value, 0) / intervals.length
    return {
      frames: intervals.length,
      fps: Math.round(1000 / mean),
      p95: Math.round(at(0.95) * 10) / 10,
      p99: Math.round(at(0.99) * 10) / 10,
      longFrameMs: Math.round(longFrames.reduce((sum, value) => sum + value, 0)),
      windowCommits: api.getWindowCommitCounts(),
    }
  })
}

const results: Record<string, unknown> = {}

for (const farView of [true, false]) {
  test(`canvas zoom sweep, far view ${farView ? 'on' : 'off'}`, async ({
    browserName: _browserName,
  }, testInfo) => {
    const { electronApp, window } = await launchApp({ deviceScaleFactor: 2 })
    try {
      await electronApp.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900, false),
      )
      await clearAndSeedWorkspace(window, scene(), {
        settings: { uiTheme: 'dark', canvasFarViewEnabled: farView },
      })
      await startOutput(window)
      await window.waitForTimeout(2_000)
      const result = await sweep(window)
      results[`farView:${farView ? 'on' : 'off'}`] = result
      // eslint-disable-next-line no-console -- the report is the point of this run.
      console.log(`[perf] far view ${farView ? 'on' : 'off'}`, JSON.stringify(result))
      await testInfo.attach('canvas-zoom', {
        body: JSON.stringify(result, null, 2),
        contentType: 'application/json',
      })
      await mkdir(testInfo.project.outputDir, { recursive: true })
      await writeFile(
        path.join(testInfo.project.outputDir, 'canvas-zoom.json'),
        `${JSON.stringify(results, null, 2)}\n`,
      )
    } finally {
      await electronApp.close()
    }
  })
}
