import { describe, expect, it } from 'vitest'
import {
  createPixelAssembly,
  buildPixelAssemblyScene,
  buildPixelAssemblyFrontier,
  PIXEL_ASSEMBLY_MS,
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

  it('starts the full 380ms only when the renderer is ready, without restarting on repeated observations', () => {
    const assembly = createPixelAssembly()
    assembly.prepare('terminal-1', 0)
    expect(assembly.sample([], 10)).toEqual([])
    expect(assembly.hasPending(10)).toBe(true)
    expect(assembly.sample(frames, 100)).toEqual([])
    expect(assembly.markReady('terminal-1', 240)).toBe(true)
    const [frame] = assembly.sample(frames, 240)
    expect(frame).toMatchObject({ id: 'terminal-1', age: 0, rect: frames[0]!.rect })
    assembly.prepare('terminal-1', 280)
    expect(assembly.markReady('terminal-1', 300)).toBe(false)
    expect(assembly.sample(frames, 300)[0]?.age).toBe(60)
    expect(assembly.pendingIds(300)).toEqual(['terminal-1'])
    expect(assembly.sample(frames, 619)[0]?.age).toBe(379)
    expect(assembly.sample(frames, 620)).toEqual([])
    expect(assembly.hasPending(620)).toBe(false)
  })

  it('fails open after a bounded 1200ms readiness wait and ignores late readiness', () => {
    const assembly = createPixelAssembly()
    assembly.prepare('terminal-1', 0)
    expect(assembly.sample(frames, 800)).toEqual([])
    expect(assembly.pendingIds(1199)).toEqual(['terminal-1'])
    expect(assembly.pendingIds(1200)).toEqual([])
    expect(assembly.markReady('terminal-1', 1300)).toBe(false)
    expect(assembly.sample(frames, 1400)).toEqual([])
  })

  it('reveals immediately on interaction and discards hidden or cancelled work', () => {
    const assembly = createPixelAssembly()
    assembly.prepare('terminal-1', 0)
    assembly.markReady('terminal-1', 0)
    expect(assembly.sample(frames, 10)).toHaveLength(1)
    expect(assembly.reveal('terminal-1')).toBe(true)
    expect(assembly.sample(frames, 20)).toEqual([])
    assembly.prepare('terminal-1', 30)
    assembly.markReady('terminal-1', 30)
    assembly.sample(frames, 40)
    assembly.sample([], 50)
    expect(assembly.sample(frames, 60)).toEqual([])
    assembly.prepare('terminal-1', 70)
    assembly.clear()
    expect(assembly.hasPending(80)).toBe(false)
  })

  it('bounds simultaneous curtains and never adds a delayed veil to overflow nodes', () => {
    const assembly = createPixelAssembly()
    const many = Array.from({ length: 40 }, (_, index) => ({ ...frames[0]!, id: `node-${index}` }))
    many.forEach(frame => assembly.prepare(frame.id, 0))
    many.forEach(frame => assembly.markReady(frame.id, 0))
    const visible = assembly.sample(many, 10)
    expect(visible).toHaveLength(8)
    visible.forEach(frame => assembly.reveal(frame.id))
    expect(assembly.sample(many, 20)).toEqual([])
    expect(assembly.hasPending(20)).toBe(false)
  })

  it('draws only converging particles and completes at the same 380ms across widths and zooms', () => {
    const frame = { ...frames[0]!, age: 0 }
    expect(PIXEL_ASSEMBLY_MS).toBe(380)
    const midway = buildPixelAssemblyScene({ ...frame, age: 190 })
    expect(Object.keys(midway)).toEqual(['particles', 'rim'])
    expect(midway.particles.length).toBeGreaterThan(50)
    expect(buildPixelAssemblyScene({ ...frame, age: 380 }).particles).toEqual([])
    expect(buildPixelAssemblyScene({ ...frame, age: 190 })).toEqual(midway)
    expect(buildPixelAssemblyFrontier(frame).every(band => band.reveal === 0)).toBe(true)
    for (const width of [160, 400, 1400, 3600]) {
      const sized = { ...frame, rect: { ...frame.rect, width }, age: 190 }
      expect(buildPixelAssemblyFrontier(sized)).toEqual(
        buildPixelAssemblyFrontier({ ...frame, age: 190 }),
      )
      expect(
        buildPixelAssemblyFrontier({ ...sized, age: 380 }).every(band => band.reveal === 1),
      ).toBe(true)
    }
  })

  it('follows current node geometry without replaying or mutating its source', () => {
    const node = pixelNode({ kind: 'document' })
    const before = structuredClone(node)
    const assembly = createPixelAssembly()
    assembly.prepare(node.id, 0)
    assembly.markReady(node.id, 120)
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

  it('gives every node kind the same creation rim without output or fake selection state', () => {
    for (const kind of [
      'terminal',
      'agent',
      'note',
      'task',
      'document',
      'image',
      'website',
      'role',
    ] as const) {
      const node = pixelNode({ kind })
      const before = structuredClone(node)
      const [frame] = projectPixelNodeFrames([node], new Map(), viewport)
      const scene = buildPixelAssemblyScene({ ...frame!, age: 190 })
      expect(scene.rim.length).toBeGreaterThan(20)
      expect(scene.rim.some(pixel => pixel.x < frame!.rect.x)).toBe(true)
      expect(scene.rim.some(pixel => pixel.y < frame!.rect.y)).toBe(true)
      expect(scene.rim.some(pixel => pixel.y > frame!.rect.y + frame!.rect.height)).toBe(true)
      expect(scene.rim.every(pixel => pixel.x < frame!.rect.x + frame!.rect.width * 0.53 + 6)).toBe(
        true,
      )
      expect(
        scene.rim.every(pixel => pixel.size <= 3 && pixel.alpha > 0 && pixel.alpha <= 0.65),
      ).toBe(true)
      expect(buildPixelAssemblyScene({ ...frame!, age: 0 }).rim).toEqual([])
      expect(buildPixelAssemblyScene({ ...frame!, age: 380 }).rim).toEqual([])
      expect(node).toEqual(before)
    }
    const large = buildPixelAssemblyScene({
      id: 'large',
      sessionId: '',
      rect: { x: 0, y: 0, width: 8000, height: 5000 },
      age: 190,
    })
    expect(large.rim.length).toBeLessThanOrEqual(224)
  })
})
