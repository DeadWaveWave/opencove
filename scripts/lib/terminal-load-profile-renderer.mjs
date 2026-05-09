/* eslint-disable no-await-in-loop -- interaction probe intentionally moves the pointer over time */

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function installRendererSampler(window) {
  await window.evaluate(() => {
    window.__opencovePerfProfile = {
      frames: [],
      longTasks: [],
      startedAt: performance.now(),
      running: true,
    }

    let lastFrameAt = performance.now()
    const tick = now => {
      const state = window.__opencovePerfProfile
      if (!state?.running) {
        return
      }
      state.frames.push(now - lastFrameAt)
      if (state.frames.length > 5_000) {
        state.frames.splice(0, state.frames.length - 5_000)
      }
      lastFrameAt = now
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)

    try {
      const observer = new PerformanceObserver(list => {
        const state = window.__opencovePerfProfile
        if (!state) {
          return
        }
        for (const entry of list.getEntries()) {
          state.longTasks.push({
            startTime: entry.startTime,
            duration: entry.duration,
            name: entry.name,
          })
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
      window.__opencovePerfProfile.longTaskObserver = observer
    } catch {
      // Long Task API is not available in every Electron mode.
    }
  })
}

export async function readRendererSample(window) {
  return await window.evaluate(() => {
    const api = window.__opencoveTerminalSelectionTestApi
    const nodeIds =
      typeof api?.getRegisteredNodeIds === 'function' ? api.getRegisteredNodeIds() : []
    const metrics = nodeIds.map(nodeId => ({
      nodeId,
      sessionId: api?.getRuntimeSessionId?.(nodeId) ?? null,
      size: api?.getSize?.(nodeId) ?? null,
      renderMetrics: api?.getRenderMetrics?.(nodeId) ?? null,
    }))
    const frames = window.__opencovePerfProfile?.frames ?? []
    const longTasks = window.__opencovePerfProfile?.longTasks ?? []
    const memory =
      'memory' in performance
        ? {
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            usedJSHeapSize: performance.memory.usedJSHeapSize,
          }
        : null

    return {
      elapsedMs: performance.now() - (window.__opencovePerfProfile?.startedAt ?? performance.now()),
      terminalNodes: document.querySelectorAll('.terminal-node').length,
      xterms: document.querySelectorAll('.terminal-node .xterm').length,
      canvases: document.querySelectorAll('.terminal-node .xterm-screen canvas').length,
      registeredNodeIds: nodeIds,
      metrics,
      frameCount: frames.length,
      frameDeltaMs: {
        p50: percentile(frames, 0.5),
        p95: percentile(frames, 0.95),
        p99: percentile(frames, 0.99),
        max: frames.length > 0 ? Math.max(...frames) : null,
      },
      longTasks: {
        count: longTasks.length,
        totalDurationMs: longTasks.reduce((sum, task) => sum + task.duration, 0),
        maxDurationMs:
          longTasks.length > 0 ? Math.max(...longTasks.map(task => task.duration)) : null,
      },
      memory,
    }

    function percentile(values, p) {
      if (values.length === 0) {
        return null
      }
      const sorted = [...values].sort((a, b) => a - b)
      const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))
      return sorted[index]
    }
  })
}

export async function runInteractionProbe(window) {
  const pane = window.locator('.workspace-canvas .react-flow__pane')
  const rect = await pane.evaluate(element => {
    const box = element.getBoundingClientRect()
    return { x: box.x, y: box.y, width: box.width, height: box.height }
  })
  const start = { x: rect.x + rect.width * 0.55, y: rect.y + rect.height * 0.55 }
  await window.mouse.move(start.x, start.y)
  await window.mouse.down()
  for (let step = 1; step <= 20; step += 1) {
    await window.mouse.move(start.x + step * 8, start.y + step * 3)
    await delay(16)
  }
  await window.mouse.up()
}
