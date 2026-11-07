import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildPixelAssemblyScene,
  createPixelAssembly,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assembly'
import {
  drawPixelAssemblies,
  readPixelAssemblyTheme,
} from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assemblyRenderer'
import { createPixelBurst } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burst'
import { drawPixelBursts } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/burstRenderer'
import { createPixelClosureSnapshots } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/closureSnapshots'
import { projectPixelNodeFrames } from '@contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/geometry'
import { pixelNode } from './workspacePixelLayer.fixtures'

const viewport = { x: 0, y: 0, zoom: 1, width: 1200, height: 800 }
const ink = {
  ai: '#aa1177',
  shell: '#117733',
  plan: '#aa6633',
  knowledge: '#3366aa',
  media: '#6633aa',
  neutral: '#888888',
}
const solid = {
  ai: '#771144',
  shell: '#114422',
  plan: '#774422',
  knowledge: '#224477',
  media: '#442277',
  neutral: '#555555',
}

function themeCanvas(tokens = true) {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  canvas.style.color = 'rgb(90, 90, 90)'
  canvas.style.setProperty('--cove-pixel-blue', '#123456')
  canvas.style.setProperty('--cove-pixel-cyan', '#234567')
  canvas.style.setProperty('--cove-pixel-mint', '#345678')
  if (tokens) {
    for (const family of Object.keys(ink) as (keyof typeof ink)[]) {
      canvas.style.setProperty(`--cove-kind-${family}-ink`, ink[family])
      canvas.style.setProperty(`--cove-kind-${family}-solid`, solid[family])
    }
  }
  return canvas
}

function drawContext() {
  const colors: unknown[] = []
  const context = {
    globalAlpha: 1,
    fillStyle: '' as unknown,
    fillRect: vi.fn(() => colors.push(context.fillStyle)),
    clearRect: vi.fn(),
    setTransform: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  }
  return { context: context as unknown as CanvasRenderingContext2D, colors }
}

afterEach(() => document.body.replaceChildren())

describe('creation and close kind colours', () => {
  it('paints both the rim and particles in kind ink, including simultaneous different kinds', () => {
    const canvas = themeCanvas()
    const nodes = [pixelNode({ kind: 'agent' }), { ...pixelNode(), id: 'terminal-2' }]
    const assembly = createPixelAssembly()
    for (const node of nodes) {
      assembly.prepare(node.id, 0)
      assembly.markReady(node.id, 0)
    }
    const frames = assembly.sample(projectPixelNodeFrames(nodes, new Map(), viewport), 120)
    const { context, colors } = drawContext()
    drawPixelAssemblies({
      canvas,
      context,
      viewport,
      frames,
      theme: readPixelAssemblyTheme(canvas),
    })
    let offset = 0
    for (const [index, frame] of frames.entries()) {
      const scene = buildPixelAssemblyScene(frame)
      expect(scene.rim.length).toBeGreaterThan(0)
      expect(scene.particles.length).toBeGreaterThan(0)
      const expected = index === 0 ? ink.ai : ink.shell
      expect(new Set(colors.slice(offset, offset + scene.rim.length))).toEqual(new Set([expected]))
      offset += scene.rim.length
      expect(new Set(colors.slice(offset, offset + scene.particles.length))).toEqual(
        new Set([expected]),
      )
      offset += scene.particles.length
    }
    expect(colors).toHaveLength(offset)
  })

  it('keeps the same window ink at different screen positions', () => {
    const canvas = themeCanvas()
    for (const position of [
      { x: 20, y: 10 },
      { x: 750, y: 550 },
    ]) {
      const [frame] = projectPixelNodeFrames(
        [{ ...pixelNode({ kind: 'agent' }), position }],
        new Map(),
        viewport,
      )
      const { context, colors } = drawContext()
      drawPixelAssemblies({
        canvas,
        context,
        viewport,
        frames: [{ ...frame, age: 120 }],
        theme: readPixelAssemblyTheme(canvas),
      })
      expect(new Set(colors)).toEqual(new Set([ink.ai]))
      expect(context.createLinearGradient).not.toHaveBeenCalled()
    }
  })

  it('uses only solid/ink in a roughly equal split and keeps each fragment colour across frames', () => {
    const canvas = themeCanvas()
    const [frame] = projectPixelNodeFrames(
      [pixelNode({ kind: 'agent', width: 620, height: 420 })],
      new Map(),
      viewport,
    )
    const burst = createPixelBurst()
    burst.announce(frame, viewport, 0)
    let previous: unknown[] | undefined
    for (const age of [0, 80, 200, 400]) {
      const { context, colors } = drawContext()
      drawPixelBursts({
        context,
        viewport,
        frames: burst.sample(viewport, age),
        theme: readPixelAssemblyTheme(canvas),
      })
      expect(new Set(colors)).toEqual(new Set([solid.ai, ink.ai]))
      const fraction = colors.filter(color => color === solid.ai).length / colors.length
      expect(fraction).toBeGreaterThanOrEqual(0.45)
      expect(fraction).toBeLessThanOrEqual(0.55)
      if (previous) {
        expect(colors).toEqual(previous)
      }
      previous = colors
    }
  })

  it('copies the family with closure geometry and draws it after source nodes are changed and removed', () => {
    const canvas = themeCanvas()
    const nodes = [pixelNode({ kind: 'agent' })]
    const snapshots = createPixelClosureSnapshots()
    const frames = projectPixelNodeFrames(nodes, new Map(), viewport)
    snapshots.capture(frames, viewport, 0)
    nodes[0].data.kind = 'terminal'
    nodes.length = 0
    snapshots.capture(projectPixelNodeFrames(nodes, new Map(), viewport), viewport, 10, new Set())
    const snapshot = snapshots.take(frames[0].id, viewport, 20)!
    expect(snapshot).toMatchObject({ family: 'ai' })
    const burst = createPixelBurst()
    burst.announce(snapshot, viewport, 20)
    const { context, colors } = drawContext()
    drawPixelBursts({
      context,
      viewport,
      frames: burst.sample(viewport, 100),
      theme: readPixelAssemblyTheme(canvas),
    })
    expect(new Set(colors)).toEqual(new Set([ink.ai, solid.ai]))
    expect(nodes).toEqual([])
  })

  it('uses the existing Pixel palette and text fallback when kind tokens are absent', () => {
    const canvas = themeCanvas(false)
    const fallback = {
      ai: '#123456',
      shell: '#234567',
      plan: '#345678',
      knowledge: '#123456',
      media: '#234567',
      neutral: 'rgb(90, 90, 90)',
    }
    expect(readPixelAssemblyTheme(canvas)).toMatchObject({ ink: fallback, solid: fallback })
    const [frame] = projectPixelNodeFrames([pixelNode()], new Map(), viewport)
    const { context, colors } = drawContext()
    drawPixelAssemblies({
      canvas,
      context,
      viewport,
      frames: [{ ...frame, age: 120 }],
      theme: readPixelAssemblyTheme(canvas),
    })
    expect(new Set(colors)).toEqual(new Set([fallback.shell]))
    colors.length = 0
    const burst = createPixelBurst()
    burst.announce(frame, viewport, 0)
    drawPixelBursts({
      context,
      viewport,
      frames: burst.sample(viewport, 80),
      theme: readPixelAssemblyTheme(canvas),
    })
    expect(new Set(colors)).toEqual(new Set([fallback.shell]))
  })
})
