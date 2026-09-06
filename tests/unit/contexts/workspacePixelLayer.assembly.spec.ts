import { describe, expect, it } from 'vitest'
import {
  createPixelAssembly,
  buildPixelAssemblyScene,
} from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/assembly'
import { projectPixelNodeFrames } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/view/pixelLayer/geometry'
import { pixelNode } from './workspacePixelLayer.fixtures'

const viewport = { x: 20, y: 10, zoom: 2, width: 1200, height: 800 }
const frames = projectPixelNodeFrames([pixelNode({ kind: 'note' })], new Map(), viewport)

describe('explicit new-node assembly', () => {
  it('does not infer creation from initial, restored or changed node sets', () => {
    const assembly = createPixelAssembly()
    expect(assembly.sample(frames, 0)).toEqual([])
    expect(assembly.sample(projectPixelNodeFrames([pixelNode()], new Map(), viewport), 10)).toEqual(
      [],
    )
    expect(assembly.hasPending(20)).toBe(false)
  })

  it('accepts only creation announcements and waits briefly for committed geometry', () => {
    const assembly = createPixelAssembly()
    assembly.announce('terminal-1', 0)
    expect(assembly.sample([], 10)).toEqual([])
    expect(assembly.hasPending(10)).toBe(true)
    const [frame] = assembly.sample(frames, 100)
    expect(frame).toMatchObject({ id: 'terminal-1', age: 100, rect: frames[0]!.rect })
    assembly.announce('terminal-1', 200)
    expect(assembly.sample(frames, 300)[0]?.age).toBe(300)
    expect(assembly.sample(frames, 720)).toEqual([])
    expect(assembly.hasPending(720)).toBe(false)
  })

  it('reveals immediately on interaction and discards hidden or cancelled work', () => {
    const assembly = createPixelAssembly()
    assembly.announce('terminal-1', 0)
    expect(assembly.sample(frames, 10)).toHaveLength(1)
    expect(assembly.reveal('terminal-1')).toBe(true)
    expect(assembly.sample(frames, 20)).toEqual([])
    assembly.announce('terminal-1', 30)
    assembly.sample(frames, 40)
    assembly.sample([], 50)
    expect(assembly.sample(frames, 60)).toEqual([])
    assembly.announce('terminal-1', 70)
    assembly.clear()
    expect(assembly.hasPending(80)).toBe(false)
  })

  it('bounds simultaneous curtains and never adds a delayed veil to overflow nodes', () => {
    const assembly = createPixelAssembly()
    const many = Array.from({ length: 40 }, (_, index) => ({ ...frames[0]!, id: `node-${index}` }))
    many.forEach(frame => assembly.announce(frame.id, 0))
    const visible = assembly.sample(many, 10)
    expect(visible).toHaveLength(8)
    visible.forEach(frame => assembly.reveal(frame.id))
    expect(assembly.sample(many, 20)).toEqual([])
    expect(assembly.hasPending(20)).toBe(false)
  })

  it('renders a substantial dissolving curtain and gathering front rather than an edge-only glow', () => {
    const frame = { ...frames[0]!, age: 0 }
    const opening = buildPixelAssemblyScene(frame)
    const midway = buildPixelAssemblyScene({ ...frame, age: 360 })
    const area = (scene: typeof opening) =>
      scene.veil.reduce((sum, rect) => sum + rect.width * rect.height, 0)
    expect(area(opening)).toBeCloseTo(frame.rect.width * frame.rect.height)
    expect(area(midway)).toBeGreaterThan(area(opening) * 0.4)
    expect(area(midway)).toBeLessThan(area(opening) * 0.6)
    expect(midway.particles.length).toBeGreaterThan(50)
    expect(buildPixelAssemblyScene({ ...frame, age: 720 }).veil).toEqual([])
    expect(buildPixelAssemblyScene({ ...frame, age: 720 }).particles).toEqual([])
    expect(buildPixelAssemblyScene({ ...frame, age: 360 })).toEqual(midway)
  })

  it('follows current node geometry without replaying or mutating its source', () => {
    const node = pixelNode({ kind: 'document' })
    const before = structuredClone(node)
    const assembly = createPixelAssembly()
    assembly.announce(node.id, 0)
    const movedFrames = projectPixelNodeFrames(
      [node],
      new Map([
        [
          node.id,
          {
            ...node,
            internals: { positionAbsolute: { x: 200, y: 150 } },
          },
        ],
      ]),
      viewport,
    )
    expect(assembly.sample(movedFrames, 200)[0]?.rect).toEqual({
      x: 420,
      y: 310,
      width: 600,
      height: 400,
    })
    expect(node).toEqual(before)
  })
})
