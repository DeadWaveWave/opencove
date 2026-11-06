import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createWallWindowTracker } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallWindows'
import { createRippleField } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/ripples'
import type { WallLightPalette } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallPalette'

const lights: WallLightPalette = {
  ai: [150, 110, 230],
  shell: [60, 180, 120],
  plan: [230, 150, 60],
  knowledge: [80, 140, 230],
  media: [220, 90, 120],
  neutral: [140, 150, 160],
  waiting: [240, 200, 20],
  failed: [240, 80, 80],
}

function windowNode(
  id: string,
  data: Partial<TerminalNodeData>,
  rect = { x: 0, y: 0, width: 300, height: 200 },
) {
  return {
    id,
    hidden: false,
    measured: { width: rect.width, height: rect.height },
    internals: { positionAbsolute: { x: rect.x, y: rect.y } },
    data: { kind: 'terminal', status: null, agent: null, sessionId: `${id}-session`, ...data },
  }
}

function lookup(...nodes: ReturnType<typeof windowNode>[]) {
  return new Map(nodes.map(node => [node.id, node])) as never
}

describe('pixel wall windows', () => {
  it('lights each window in its kind colour at its state level', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(lookup(windowNode('shell', { kind: 'terminal' })), 0)
    const { windows, animating } = tracker.resolve(1000, lights)
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({ x: 0, y: 0, width: 300, height: 200 })
    expect(windows[0]!.light).toEqual({ color: lights.shell, intensity: 0.46 })
    expect(animating).toBe(false)
  })

  it('turns waiting agents yellow and failed ones red, and breathes while working', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(
      lookup(
        windowNode('wait', { kind: 'agent', status: 'waiting' }),
        windowNode('fail', { kind: 'agent', status: 'failed' }),
        windowNode('work', { kind: 'agent', status: 'running' }),
      ),
      0,
    )
    const { windows, animating } = tracker.resolve(1000, lights)
    expect(windows.map(window => window.light?.color)).toEqual([
      lights.waiting,
      lights.failed,
      lights.ai,
    ])
    expect(animating).toBe(true)
  })

  it('flares once when an agent finishes, and only on that transition', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'running' })), 0)
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'standby' })), 2000)
    expect(tracker.resolve(2000, lights).windows[0]!.light?.intensity).toBeCloseTo(1)
    expect(tracker.resolve(2000, lights).animating).toBe(true)
    // A window that starts in standby (a reload) does not flare.
    const reloaded = createWallWindowTracker()
    reloaded.sync(lookup(windowNode('agent', { kind: 'agent', status: 'standby' })), 2000)
    expect(reloaded.resolve(2000, lights).windows[0]!.light?.intensity).toBeCloseTo(0.6)
  })

  it('brightens the window whose session produced output and ignores other sessions', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(lookup(windowNode('a', {}), windowNode('b', {})), 0)
    expect(tracker.observeOutput('b-session', 500)).toMatchObject({
      id: 'b',
      center: { x: 150, y: 100 },
      family: 'shell',
    })
    expect(tracker.observeOutput('missing', 500)).toBeNull()
    const [a, b] = tracker.resolve(500, lights).windows
    expect(b!.light!.intensity).toBeGreaterThan(a!.light!.intensity)
  })

  it('ignores an agent repaint stream while throttling terminal output and light together', () => {
    const tracker = createWallWindowTracker()
    const baseline = createWallWindowTracker()
    const nodes = lookup(
      windowNode('agent', { kind: 'agent', status: 'running' }),
      windowNode('shell', {}),
    )
    tracker.sync(nodes, 0)
    baseline.sync(nodes, 0)
    const field = createRippleField()
    const emitted: string[] = []
    for (let now = 0; now <= 3040; now += 80) {
      for (const id of ['agent', 'shell']) {
        const source = tracker.observeOutput(`${id}-session`, now)
        if (source && field.emit(source.id, source.center, lights[source.family], now)) {
          emitted.push(source.id)
        }
      }
      expect(tracker.resolve(now, lights).windows[0]!.light).toEqual(
        baseline.resolve(now, lights).windows[0]!.light,
      )
    }
    expect(emitted).toEqual(Array(5).fill('shell'))
    // Repaints between accepted terminal output signals must not keep recharging the light.
    const once = createWallWindowTracker()
    once.sync(lookup(windowNode('shell', {})), 0)
    once.observeOutput('shell-session', 2880)
    expect(tracker.resolve(3040, lights).windows[1]!.light).toEqual(
      once.resolve(3040, lights).windows[0]!.light,
    )
  })

  it('starts restored windows lit even before measurement, and fades only new identities', () => {
    const tracker = createWallWindowTracker(['restore'])
    const restored = windowNode('restore', {}, { x: 0, y: 0, width: 0, height: 0 })
    tracker.sync(lookup(restored), 0)
    restored.measured = { width: 300, height: 200 }
    tracker.sync(lookup(restored, windowNode('new', {})), 1000)
    expect(tracker.resolve(1000, lights).windows.map(window => window.light!.intensity)).toEqual([
      0.46, 0,
    ])
    expect(tracker.resolve(1350, lights).windows[1]!.light!.intensity).toBeCloseTo(0.23)
    expect(tracker.resolve(1700, lights).animating).toBe(false)
    restored.hidden = true
    tracker.sync(lookup(restored), 2000)
    restored.hidden = false
    tracker.sync(lookup(restored), 3000)
    expect(tracker.resolve(3000, lights).windows[0]!.light!.intensity).toBe(0.46)
  })

  it('fades the first new window in an empty canvas, but never an ongoing restore', () => {
    const tracker = createWallWindowTracker([])
    tracker.sync(lookup(), 0)
    tracker.sync(lookup(windowNode('new', {})), 1000)
    expect(tracker.resolve(1000, lights).windows[0]!.light!.intensity).toBe(0)
    tracker.sync(lookup(windowNode('restoring', { kind: 'agent', status: 'restoring' })), 2000)
    expect(tracker.resolve(2000, lights).windows[0]!.light!.intensity).toBeGreaterThanOrEqual(0.64)
  })

  it('does not mistake a restored state becoming ready for a finished run', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'restoring' })), 0)
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'standby' })), 1000)
    expect(tracker.resolve(1000, lights).windows[0]!.light!.intensity).toBe(0.6)
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'running' })), 2000)
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'standby' })), 3000)
    expect(tracker.resolve(3000, lights).windows[0]!.light!.intensity).toBe(1)
  })

  it('gives working windows stable distinct phases and flashes a live failure only once', () => {
    const tracker = createWallWindowTracker()
    const running = lookup(
      windowNode('alpha', { kind: 'agent', status: 'running' }),
      windowNode('beta', { kind: 'agent', status: 'running' }),
    )
    tracker.sync(running, 0)
    const levels = tracker.resolve(600, lights).windows.map(window => window.light!.intensity)
    expect(levels[0]).not.toBeCloseTo(levels[1]!, 6)
    tracker
      .resolve(3000, lights)
      .windows.forEach((window, index) =>
        expect(window.light!.intensity).toBeCloseTo(levels[index]!, 10),
      )
    const failed = lookup(windowNode('alpha', { kind: 'agent', status: 'failed' }))
    tracker.sync(failed, 1000)
    expect(tracker.resolve(1000, lights).windows[0]!.light!.intensity).toBe(1)
    tracker.sync(failed, 2000)
    expect(tracker.resolve(2250, lights).windows[0]!.light!.intensity).toBeCloseTo(0.925)
    tracker.resolve(null, lights)
    expect(tracker.resolve(2300, lights).windows[0]!.light!.intensity).toBe(0.9)
  })

  it('holds fixed levels without a clock and forgets windows that are gone', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(lookup(windowNode('agent', { kind: 'agent', status: 'running' })), 0)
    expect(tracker.resolve(null, lights).animating).toBe(false)
    tracker.sync(lookup(), 100)
    expect(tracker.resolve(200, lights).windows).toEqual([])
    expect(tracker.observeOutput('agent-session', 300)).toBeNull()
  })
})

describe('pixel wall waiting windows', () => {
  it('limits sonar and beacons to their respective screen margins', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(
      lookup(
        windowNode(
          'work-in',
          { kind: 'agent', status: 'running' },
          { x: 1599, y: 0, width: 100, height: 100 },
        ),
        windowNode(
          'work-out',
          { kind: 'agent', status: 'running' },
          { x: 1601, y: 0, width: 100, height: 100 },
        ),
        windowNode(
          'wait-in',
          { kind: 'agent', status: 'waiting' },
          { x: 1439, y: 0, width: 100, height: 100 },
        ),
        windowNode(
          'wait-out',
          { kind: 'agent', status: 'waiting' },
          { x: 1441, y: 0, width: 100, height: 100 },
        ),
      ),
      0,
    )
    const view = { x: 0, y: 0, width: 600, height: 400, zoom: 0.5 }
    expect(tracker.working(view).map(window => window.id)).toEqual(['work-in'])
    expect(tracker.waiting(view).map(window => window.id)).toEqual(['wait-in'])
  })

  it('lists the windows waiting for you with their centres', () => {
    const tracker = createWallWindowTracker()
    tracker.sync(
      lookup(
        windowNode(
          'wait',
          { kind: 'agent', status: 'waiting' },
          { x: 100, y: 0, width: 200, height: 100 },
        ),
        windowNode('work', { kind: 'agent', status: 'running' }),
      ),
      0,
    )
    expect(tracker.waiting()).toMatchObject([{ id: 'wait', center: { x: 200, y: 50 } }])
  })
})
