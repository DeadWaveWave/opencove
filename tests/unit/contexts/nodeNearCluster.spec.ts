// @vitest-environment node
import { expect, it } from 'vitest'
import { fixture } from './nodeControlNear.helpers'
import { isRectInsideRect } from '../../../src/contexts/space/application/spaceContainment'
import { SPACE_NODE_PADDING as padding } from '../../../src/contexts/workspace/domain/workspaceSpaceLayout'

type Rect = { x: number; y: number; width: number; height: number }
function distance(a: Rect, b: Rect) {
  return Math.hypot(
    Math.max(a.x - b.x - b.width, b.x - a.x - a.width, 0),
    Math.max(a.y - b.y - b.height, b.y - a.y - a.height, 0),
  )
}
it.each([false, true])(
  'keeps sequential mixed-size helpers clustered around the reference (root=%s)',
  async root => {
    const f = fixture(),
      w = f.state().workspaces[0]
    Object.assign(w.nodes[0], { width: 520, height: 420 })
    if (root) {
      w.spaces = []
    } else {
      w.spaces[0].rect = { x: 1000, y: 1900, width: 6000, height: 1000 }
    }
    const before = structuredClone(w.nodes[0])
    const reference = { ...before.position, width: before.width, height: before.height }
    const frames: Rect[] = [reference]
    for (const kind of ['note', 'terminal', 'agent'] as const) {
      const { node } = await f.run({ kind })
      if (kind === 'agent') {
        expect(node.frame.height).toBeGreaterThan(reference.height)
      }
      expect(distance(reference, node.frame)).toBeLessThanOrEqual(node.frame.width + padding)
      // A free edge-adjacent slot exists for every helper in this fixture.
      expect(distance(reference, node.frame)).toBe(padding)
      frames.forEach(frame => expect(distance(frame, node.frame)).toBeGreaterThan(0))
      if (kind === 'note') {
        expect(node.frame).toMatchObject({
          x: reference.x + reference.width + padding,
          y: reference.y,
        })
      }
      if (kind === 'terminal') {
        expect(node.frame).toMatchObject({
          x: reference.x + reference.width + padding,
          y: frames[1].y + frames[1].height + padding,
        })
      }
      if (kind === 'agent') {
        if (root) {
          expect(node.frame.y).toBe(reference.y + reference.height + padding)
        } else {
          // The left column fits without growing the Space; the row below would grow it.
          expect(node.frame.x).toBe(reference.x - node.frame.width - padding)
        }
      }
      if (!root) {
        expect(isRectInsideRect(node.frame, f.state().workspaces[0].spaces[0].rect!)).toBe(true)
      }
      frames.push(node.frame)
    }
    expect(f.state().workspaces[0].nodes[0]).toEqual(before)
  },
)

it('uses the left column before distant slots when right and below are blocked', async () => {
  const f = fixture(),
    w = f.state().workspaces[0],
    ref = w.nodes[0]
  const template = structuredClone(ref)
  w.nodes.push(
    {
      ...template,
      id: 'right-block',
      position: { x: ref.position.x + ref.width + padding, y: ref.position.y },
      width: 1200,
      height: 1200,
    },
    {
      ...template,
      id: 'below-block',
      position: { x: ref.position.x, y: ref.position.y + ref.height + padding },
      width: 1200,
      height: 1200,
    },
  )
  const before = structuredClone(w.nodes)
  const { node } = await f.run({ kind: 'agent' })
  expect(node.frame).toMatchObject({
    x: ref.position.x - node.frame.width - padding,
    y: ref.position.y,
  })
  before.forEach(n =>
    expect(
      distance({ ...n.position, width: n.width, height: n.height }, node.frame),
    ).toBeGreaterThan(0),
  )
  expect(f.state().workspaces[0].nodes.slice(0, 3)).toEqual(before)
})

it('reorders anchors after a CAS conflict using the moved reference and competing node, without relaunch', async () => {
  const f = fixture(),
    w = f.state().workspaces[0]
  Object.assign(w.nodes[0], { width: 520, height: 420 })
  const write = f.writeAppState.getMockImplementation()!
  f.writeAppState.mockImplementationOnce(async (next, options) => {
    f.advance(state => {
      const current = state.workspaces[0],
        ref = current.nodes[0]
      ref.position = { x: 4000, y: 2400 }
      current.nodes.push({
        ...structuredClone(ref),
        id: 'competitor',
        position: { x: 4544, y: 2400 },
        height: 172,
      })
    })
    return write(next, options)
  })
  const { node } = await f.run({ kind: 'agent' })
  expect(node.frame).toMatchObject({ x: 4544, y: 2596 })
  const current = f.state().workspaces[0]
  current.nodes
    .slice(0, 2)
    .forEach(n =>
      expect(
        distance({ ...n.position, width: n.width, height: n.height }, node.frame),
      ).toBeGreaterThan(0),
    )
  expect(f.writeAppState).toHaveBeenCalledTimes(2)
  expect(f.runtime.launchAgent).toHaveBeenCalledTimes(1)
  expect(f.runtime.killSession).not.toHaveBeenCalled()
})

it('keeps Space obstacles in force when trying compact anchors', async () => {
  const f = fixture(),
    w = f.state().workspaces[0],
    ref = w.nodes[0]
  const obstacle = {
    x: ref.position.x + ref.width + padding,
    y: ref.position.y - 100,
    width: 1500,
    height: 1200,
  }
  w.spaces.push({ ...w.spaces[0], id: 'obstacle', nodeIds: [], rect: obstacle })
  const { node } = await f.run()
  expect(node.frame).toMatchObject({ x: ref.position.x, y: ref.position.y + ref.height + padding })
  expect(distance(node.frame, obstacle)).toBeGreaterThan(0)
})
