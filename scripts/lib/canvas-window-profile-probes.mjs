/* eslint-disable no-await-in-loop -- real mouse events must remain ordered */
import { setTimeout as delay } from 'node:timers/promises'

export async function installProbes(electronApp, page) {
  await electronApp.evaluate(({ app, BrowserWindow }) => {
    const samples = []
    const events = []
    const startedAt = performance.now()
    const timeOrigin = performance.timeOrigin
    let previousAt = startedAt
    let dropped = 0
    const window = BrowserWindow.getAllWindows()[0]
    const listeners = ['focus', 'blur', 'resize', 'unresponsive', 'responsive'].map(name => {
      const listener = () => {
        if (events.length < 2_000) {
          events.push({ name, at: performance.now() - startedAt })
        } else {
          dropped += 1
        }
      }
      window.on(name, listener)
      return [name, listener]
    })
    app.getAppMetrics()
    const timer = setInterval(() => {
      const now = performance.now()
      if (samples.length < 1_000) {
        samples.push({
          at: now - startedAt,
          timerDelayMs: Math.max(0, now - previousAt - 250),
          metrics: app.getAppMetrics(),
        })
      } else {
        dropped += 1
      }
      previousAt = now
    }, 250)
    globalThis.__opencoveStallMain = {
      stop() {
        clearInterval(timer)
        for (const [name, listener] of listeners) {
          window.removeListener(name, listener)
        }
        return { startedAt, timeOrigin, samples, events, dropped }
      },
    }
  })
  await page.evaluate(() => {
    const startedAt = performance.now()
    const data = {
      startedAt,
      timeOrigin: performance.timeOrigin,
      frames: [],
      longTasks: [],
      events: [],
      dropped: 0,
    }
    const append = (list, entry) => {
      if (list.length < 20_000) {
        list.push(entry)
      } else {
        data.dropped += 1
      }
    }
    let previousAt = startedAt
    let wasVisible = document.visibilityState === 'visible'
    let wasFocused = document.hasFocus()
    let frameId
    const frame = now => {
      const visible = document.visibilityState === 'visible'
      const focused = document.hasFocus()
      append(data.frames, {
        at: now - startedAt,
        deltaMs: now - previousAt,
        visible: wasVisible && visible,
        focused: wasFocused && focused,
      })
      previousAt = now
      wasVisible = visible
      wasFocused = focused
      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    const events = ['focus', 'blur', 'visibilitychange', 'pointerdown', 'pointerup']
    const mark = name => {
      performance.mark(`opencove-profile:${name}`)
      append(data.events, {
        name,
        at: performance.now() - startedAt,
        visible: document.visibilityState,
        focused: document.hasFocus(),
      })
      // A focus round-trip between frames must not count as a foreground frame.
      if (name === 'blur' || document.visibilityState !== 'visible') {
        wasFocused = false
        wasVisible = false
      }
    }
    const listener = event => mark(event.type)
    for (const name of events) {
      window.addEventListener(name, listener, true)
    }
    const longTasksSupported = PerformanceObserver.supportedEntryTypes.includes('longtask')
    const observer = longTasksSupported
      ? new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            append(data.longTasks, { at: entry.startTime - startedAt, duration: entry.duration })
          }
        })
      : null
    observer?.observe({ type: 'longtask' })
    mark('capture-start')
    window.__opencoveStallRenderer = {
      mark,
      stop() {
        mark('capture-stop')
        cancelAnimationFrame(frameId)
        if (observer) {
          for (const entry of observer.takeRecords()) {
            append(data.longTasks, { at: entry.startTime - startedAt, duration: entry.duration })
          }
          observer.disconnect()
        }
        for (const name of events) {
          window.removeEventListener(name, listener, true)
        }
        return { ...data, longTasksSupported }
      },
    }
  })
}

export async function runPan(page, durationMs) {
  const point = await page.locator('.workspace-canvas .react-flow__pane').evaluate(pane => {
    const box = pane.getBoundingClientRect()
    for (let y = box.top + 40; y < box.bottom - 60; y += 60) {
      for (let x = box.left + 60; x < box.right - 200; x += 60) {
        if (document.elementFromPoint(x, y) === pane) {
          return { x, y }
        }
      }
    }
    throw new Error('No exposed canvas pane available for pan')
  })
  const viewport = page.locator('.react-flow__viewport')
  const before = await viewport.getAttribute('style')
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  try {
    const start = performance.now()
    let step = 0
    while (performance.now() - start < durationMs) {
      step += 1
      await page.mouse.move(
        point.x + 100 + Math.sin(step / 8) * 100,
        point.y + Math.sin(step / 12) * 30,
      )
      await delay(8)
    }
  } finally {
    await page.mouse.up()
  }
  const after = await viewport.getAttribute('style')
  if (before === after) {
    throw new Error('Pan probe did not change the canvas viewport')
  }
  return { before, after }
}
