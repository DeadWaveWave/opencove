import { describe, expect, it } from 'vitest'
import {
  createPixelActivity,
  projectPixelNodes,
  pixelNoise,
  resolvePixelBuffer,
  resolvePixelGrid,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/model'
import { pixelNode } from './workspacePixelLayer.fixtures'

const viewport = { x: 20, y: 10, zoom: 2, width: 1200, height: 800 }

describe('workspace pixel projection', () => {
  it('reads absolute measured geometry once and leaves node data unchanged', () => {
    const node = { ...pixelNode(), parentId: 'space' }
    const before = structuredClone(node)
    const lookup = new Map([
      [
        node.id,
        {
          ...node,
          measured: { width: 320, height: 220 },
          internals: { positionAbsolute: { x: 150, y: 120 } },
        },
      ],
    ])
    const [projected] = projectPixelNodes([node], lookup, viewport)
    expect(projected?.rect).toEqual({ x: 320, y: 250, width: 640, height: 440 })
    expect(node).toEqual(before)
    expect(projectPixelNodes([node], new Map(), viewport)).toEqual([])
  })

  it('culls offscreen, hidden and label-filtered nodes', () => {
    const node = pixelNode()
    expect(
      projectPixelNodes(
        [
          { ...node, position: { x: -1000, y: -1000 } },
          { ...node, hidden: true },
          {
            ...node,
            data: { ...node.data, collapsePresentation: { collapsed: true, spaceHidden: false } },
          },
          { ...node, className: 'cove-node--filtered-out' },
        ],
        new Map(),
        viewport,
      ),
    ).toEqual([])
  })

  it('uses the shared Agent presentation including terminal overlays and degraded observations', () => {
    const waiting = pixelNode({
      agentOverlay: { provider: 'codex', status: 'running', startedAtMs: 0 },
      agentRuntimeObservation: {
        status: 'waiting',
        source: 'codex_hook',
        hookInstallState: 'installed',
        degraded: false,
      },
    })
    expect(projectPixelNodes([waiting], new Map(), viewport)[0]).toMatchObject({
      tone: 'warning',
      acceptsOutput: true,
    })
    waiting.data.agentRuntimeObservation!.degraded = true
    expect(projectPixelNodes([waiting], new Map(), viewport)[0]).toMatchObject({
      tone: null,
      acceptsOutput: false,
    })
    const restoring = pixelNode({ kind: 'agent', status: 'restoring' })
    expect(projectPixelNodes([restoring], new Map(), viewport)[0]?.acceptsOutput).toBe(false)
  })

  it('caps the buffer DPR and grid cost and keeps noise stable across redraws', () => {
    expect(resolvePixelBuffer(1200, 800, 4)).toEqual({ width: 2400, height: 1600, dpr: 2 })
    const grid = resolvePixelGrid({ ...viewport, zoom: 0.1, width: 8000, height: 5000 }, 17)
    expect(grid.layers.reduce((sum, layer) => sum + layer.columns * layer.rows, 0)).toBeLessThan(
      9000,
    )
    expect(pixelNoise(-8, 12)).toBe(pixelNoise(-8, 12))
    expect(pixelNoise(-8, 12)).not.toBe(pixelNoise(-7, 12))
  })

  it.each(['terminal', 'agent'] as const)(
    'suppresses %s output during restoration and session handoff',
    kind => {
      for (const recovery of [
        { status: 'restoring' as const },
        { runtimeSessionBinding: { phase: 'preparing' as const, sessionId: 'old-session' } },
        { runtimeSessionBinding: { phase: 'publishing' as const, sessionId: 'new-session' } },
      ]) {
        const node = pixelNode({
          kind,
          status: 'running',
          agentRuntimeObservation: {
            status: 'running',
            source: 'codex_hook',
            hookInstallState: 'installed',
            degraded: false,
          },
          ...recovery,
        })
        expect(projectPixelNodes([node], new Map(), viewport)[0]).toMatchObject({
          tone: null,
          acceptsOutput: false,
        })
      }
    },
  )
})

describe('received output activity', () => {
  it('coalesces bursts and expires without retaining transcript or extending expired work', () => {
    const activity = createPixelActivity()
    const nodes = projectPixelNodes([pixelNode()], new Map(), viewport)
    activity.observe('unrelated', nodes, 0)
    expect(activity.intensity(nodes[0]!, 0)).toBe(0)
    for (let now = 0; now < 100; now++) {
      activity.observe('session-1', nodes, now)
    }
    expect(activity.intensity(nodes[0]!, 99)).toBe(1)
    expect(activity.intensity(nodes[0]!, 1149)).toBe(0)
    activity.prune(nodes, 1149)
    expect(activity.intensity(nodes[0]!, 99)).toBe(0)
  })

  it('discards activity after session rebinding, offscreen removal and explicit suspension', () => {
    const activity = createPixelActivity()
    const nodes = projectPixelNodes([pixelNode()], new Map(), viewport)
    activity.observe('session-1', nodes, 100)
    const rebound = [{ ...nodes[0]!, sessionId: 'session-2' }]
    activity.prune(rebound, 101)
    expect(activity.intensity(nodes[0]!, 101)).toBe(0)
    activity.observe('session-1', nodes, 200)
    activity.prune([], 201)
    expect(activity.intensity(nodes[0]!, 201)).toBe(0)
    activity.observe('session-1', nodes, 300)
    activity.clear()
    expect(activity.intensity(nodes[0]!, 301)).toBe(0)
  })
})
