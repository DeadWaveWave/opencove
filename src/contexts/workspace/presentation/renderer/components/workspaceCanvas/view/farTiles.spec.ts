import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData, WorkspaceNodeKind } from '../../../types'
import { buildFarTiles } from './farTiles'

function node(
  id: string,
  kind: WorkspaceNodeKind,
  data: Partial<TerminalNodeData> = {},
  extra: Partial<Node<TerminalNodeData>> = {},
): Node<TerminalNodeData> {
  return {
    id,
    position: { x: 100, y: 200 },
    width: 460,
    height: 300,
    data: {
      kind,
      title: `${id} title`,
      status: null,
      width: 460,
      height: 300,
      agent: null,
      ...data,
    },
    ...extra,
  } as Node<TerminalNodeData>
}

describe('far view tiles', () => {
  it('places one tile per expanded window at its canvas frame', () => {
    expect(
      buildFarTiles([node('note', 'note', { effectiveLabelColor: 'orange' }, { selected: true })]),
    ).toEqual([
      {
        id: 'note',
        kind: 'note',
        family: 'knowledge',
        title: 'note title',
        signal: null,
        labelColor: 'orange',
        selected: true,
        provider: null,
        pluginId: null,
        filePath: null,
        x: 100,
        y: 200,
        width: 460,
        height: 300,
      },
    ])
  })

  it('leaves collapsed windows, hidden Spaces and hidden nodes to their own presentation', () => {
    const tiles = buildFarTiles([
      node('icon', 'note', { collapsePresentation: { collapsed: true, spaceHidden: false } }),
      node('folded', 'note', { collapsePresentation: { collapsed: true, spaceHidden: true } }),
      node('hidden', 'note', {}, { hidden: true }),
      node('open', 'terminal'),
    ])
    expect(tiles.map(tile => tile.id)).toEqual(['open'])
    expect(tiles[0]?.family).toBe('shell')
  })

  it('shows what an agent is doing and which provider runs it', () => {
    const [agent] = buildFarTiles([
      node('agent', 'agent', {
        status: 'waiting',
        agent: { provider: 'codex' } as TerminalNodeData['agent'],
      }),
    ])
    expect(agent).toMatchObject({ family: 'ai', signal: 'waiting', provider: 'codex' })
  })

  it('falls back to the measured size when React Flow has not sized the node', () => {
    const [tile] = buildFarTiles([
      node(
        'measured',
        'task',
        {},
        { width: undefined, height: undefined, measured: { width: 320, height: 180 } },
      ),
    ])
    expect(tile).toMatchObject({ width: 320, height: 180, family: 'plan' })
  })
})
