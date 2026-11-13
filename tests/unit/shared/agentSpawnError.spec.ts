import { expect, it } from 'vitest'
import { agentSpawnErrorPresentation } from '../../../src/shared/errors/agentSpawnError'
import { shellWord } from '../../../src/app/cli/core/shellWord'

it.each(['agent.spawn_depth_limit', 'agent.spawn_concurrency_limit'])(
  '%s gives a usable recovery route for six plain terminals',
  code => {
    const nodes = Array.from({ length: 6 }, (_, i) => ({
      nodeId: `terminal-${i}`,
      title: `Shell ${i}`,
      kind: 'terminal',
      depth: 2,
      state: 'running',
    }))
    const { hint } = agentSpawnErrorPresentation({ code, details: { nodes } })!
    expect(hint).not.toContain('opencove agent stop')
    for (const node of nodes) {
      expect(hint).toContain(node.title)
      expect(hint).toContain(`opencove node get --node ${node.nodeId} --fields sessionId`)
    }
    expect(hint).toContain('node.sessionId')
    expect(hint).toContain('opencove session kill --session <sessionId>')
  },
)
it.each(['11111111-1111-4111-8111-111111111111', 'legacy-agent', 'node with space', "node'quote"])(
  'formats recovery commands using the existing shellWord rule for %j',
  nodeId => {
    const { hint } = agentSpawnErrorPresentation({
      code: 'agent.spawn_concurrency_limit',
      details: {
        nodes: [{ nodeId, title: 'Reviewer', kind: 'agent', depth: 2, state: 'running' }],
      },
    })!
    expect(hint).toContain(`opencove agent stop --node ${shellWord(nodeId)}`)
  },
)
