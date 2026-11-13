// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { run } from '../../../src/app/cli/core/run'
import type { CreateNodeInput, CreateNodeResult } from '../../../src/shared/contracts/dto'
import { completedPromptFixture } from '../../unit/app/cliAgentPromptWait.helpers'
import { node } from '../../unit/app/cliIdentity.helpers'
import { snapshot } from '../../unit/app/cliAgentWait.helpers'
import { fixture as placementFixture } from '../../unit/contexts/nodeControlNear.helpers'

function fixture() {
  const f = completedPromptFixture(),
    placement = placementFixture()
  const workspace = placement.state().workspaces[0]
  workspace.nodes[0].id = node.id
  workspace.spaces[0].nodeIds = [node.id]
  const created: CreateNodeResult[] = []
  const launch = placement.runtime.launchAgent!
  let sequence = 0
  placement.runtime.launchAgent = vi.fn(async (...args) => ({
    ...(await launch(...args)),
    sessionId: `session-${++sequence}`,
  }))
  f.io.readStdinText = async () =>
    JSON.stringify([
      { prompt: 'Review the tests', title: 'Tests' },
      { prompt: 'Review the documentation', title: 'Docs' },
    ])
  const fetch = f.io.fetch
  const observation = (result: CreateNodeResult) => ({
    ...snapshot(result.node.id, 'idle'),
    sessionId: result.node.sessionId,
    provider: 'codex',
    lastEndedTurn: { id: `turn-${result.node.id}`, endedAt: 10, outcome: 'completed' },
  })
  f.io.fetch = async (url, init) => {
    const request = JSON.parse(String(init?.body))
    let value: unknown
    if (request.id === 'node.create') {
      f.requests.push(request)
      value = await placement.run(request.payload as CreateNodeInput)
      created.push(value as CreateNodeResult)
    } else if (request.id === 'agent.get') {
      const target = created.find(result =>
        request.payload.sessionId
          ? result.node.sessionId === request.payload.sessionId
          : result.node.id === request.payload.nodeId,
      )!
      value = observation(target)
    } else if (request.id === 'agent.list') {
      value = { epoch: 'e', seq: 20, turnArchive: true, agents: created.map(observation) }
    } else if (request.id === 'agent.finalMessage') {
      const target = created.find(result =>
        request.payload.sessionId
          ? result.node.sessionId === request.payload.sessionId
          : result.node.id === request.payload.nodeId,
      )!
      value = {
        ...(f.values['agent.finalMessage'] as object),
        nodeId: target.node.id,
        sessionId: target.node.sessionId,
        turnId: `turn-${target.node.id}`,
      }
    } else {
      return fetch(url, init)
    }
    return new Response(JSON.stringify({ ok: true, value }))
  }
  return { ...f, placement, created }
}
const args = [
  'node',
  'create',
  'agent',
  '--near',
  node.id,
  '--provider',
  'codex',
  '--prompts-file',
  '-',
  '--wait',
]

it.each([false, true])(
  'places every batch entry near the reference using current state (root=%s)',
  async root => {
    const f = fixture()
    const code = await run([...args, ...(root ? ['--root-canvas'] : [])], f.io)
    expect(code, f.out()).toBe(0)
    const creates = f.requests.filter(r => r.id === 'node.create')
    expect(creates).toHaveLength(2)
    expect(creates.map(r => r.payload.near)).toEqual(
      Array.from({ length: 2 }, () => ({
        nodeId: node.id,
        target: root ? 'root-canvas' : 'reference-container',
      })),
    )
    expect(creates.every(r => r.payload.frame === undefined)).toBe(true)
    expect(creates.map(r => r.payload.title)).toEqual(['Tests', 'Docs'])
    const [first, second] = f.created.map(result => result.node.frame)
    expect(
      first.x + first.width <= second.x ||
        second.x + second.width <= first.x ||
        first.y + first.height <= second.y ||
        second.y + second.height <= first.y,
    ).toBe(true)
    expect(f.created.map(result => result.spaceId)).toEqual(
      root ? [null, null] : ['space', 'space'],
    )
    expect(JSON.parse(f.out()).map((entry: { ok: boolean }) => entry.ok)).toEqual([true, true])
    expect(f.placement.runtime.launchAgent).toHaveBeenCalledTimes(2)
  },
)

it('retains both batch entries when the Worker does not support near placement', async () => {
  const f = fixture()
  f.values['system.capabilities'] = { features: { nodeNearPlacementV1: false } }
  const code = await run(args, f.io)
  expect(code, f.out()).toBe(5)
  expect(f.created).toEqual([])
  expect(f.placement.runtime.launchAgent).not.toHaveBeenCalled()
  expect(JSON.parse(f.out())).toMatchObject([
    {
      index: 0,
      title: 'Tests',
      ok: false,
      exitCode: 5,
      error: { error: { code: 'cli.unsupported' } },
    },
    {
      index: 1,
      title: 'Docs',
      ok: false,
      exitCode: 5,
      error: { error: { code: 'cli.unsupported' } },
    },
  ])
})
