import { test } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { launchApp } from '../e2e/workspace-canvas.helpers'
import {
  prepareDragScene,
  sampleContinuousDrag,
} from '../e2e/workspace-canvas.drag-performance.helpers'

/** Same fixture/cadence for before/after. Profiling is separate from the three timing trials. */
test('continuous window drag with pixel wall, terminals and Space minimaps', async () => {
  const { electronApp, window } = await launchApp({ deviceScaleFactor: 2 })
  const directory = path.resolve(
    process.env.OPENCOVE_DRAG_REPORT_DIR ?? 'artifacts/drag-performance',
  )
  await mkdir(directory, { recursive: true })
  try {
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.setContentSize(1440, 900, false),
    )
    const session = await window.context().newCDPSession(window)
    await session.send('Emulation.setEmulatedMedia', {
      features: [
        { name: 'prefers-reduced-motion', value: 'no-preference' },
        { name: 'prefers-reduced-transparency', value: 'no-preference' },
      ],
    })
    await prepareDragScene(window, 100)
    const results = []
    for (let trial = 0; trial < 3; trial++) {
      // eslint-disable-next-line no-await-in-loop -- separate, sequential timing trials.
      const result = await sampleContinuousDrag(window)
      results.push(result)
      // eslint-disable-next-line no-console -- retain the benchmark results in the run log.
      console.log('[perf:drag]', JSON.stringify({ trial, ...result }))
    }
    await writeFile(
      path.join(directory, 'timings.json'),
      JSON.stringify(
        {
          revision: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
          mode: process.env.OPENCOVE_E2E_WINDOW_MODE,
          results,
        },
        null,
        2,
      ),
    )
    if (process.env.OPENCOVE_DRAG_PROFILE === '1') {
      await session.send('Profiler.enable')
      await session.send('Profiler.setSamplingInterval', { interval: 100 })
      await session.send('Profiler.start')
      const events: unknown[] = []
      session.on('Tracing.dataCollected', event => events.push(...event.value))
      await session.send('Tracing.start', {
        categories: 'devtools.timeline,blink.user_timing',
        options: 'record-as-much-as-possible',
      })
      await sampleContinuousDrag(window, 120)
      const { profile } = await session.send('Profiler.stop')
      const completed = new Promise(resolve => session.once('Tracing.tracingComplete', resolve))
      await session.send('Tracing.end')
      await completed
      await writeFile(path.join(directory, 'drag.cpuprofile'), JSON.stringify(profile))
      await writeFile(
        path.join(directory, 'drag.trace.json'),
        JSON.stringify({ traceEvents: events }),
      )
    }
    await window.screenshot({ path: path.join(directory, 'scene.png') })
  } finally {
    await electronApp.close()
  }
})
