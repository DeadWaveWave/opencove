import { describe, expect, it } from 'vitest'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { createWallWindowTracker } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelWall/wallWindows'
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
    expect(tracker.observeOutput('b-session', 500)).toEqual({
      id: 'b',
      center: { x: 150, y: 100 },
      family: 'shell',
    })
    expect(tracker.observeOutput('missing', 500)).toBeNull()
    const [a, b] = tracker.resolve(500, lights).windows
    expect(b!.light!.intensity).toBeGreaterThan(a!.light!.intensity)
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
    expect(tracker.waiting()).toEqual([{ id: 'wait', center: { x: 200, y: 50 } }])
  })
})
