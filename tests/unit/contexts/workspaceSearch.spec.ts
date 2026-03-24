import { describe, expect, it } from 'vitest'
import type { Node } from '@xyflow/react'
import type { TerminalNodeData } from '../../../src/contexts/workspace/presentation/renderer/types'
import { searchWorkspace } from '../../../src/app/renderer/shell/utils/workspaceSearch'

function asNode(value: unknown): Node<TerminalNodeData> {
  return value as Node<TerminalNodeData>
}

describe('searchWorkspace', () => {
  it('matches task title and requirement', () => {
    const nodes = [
      asNode({
        id: 'task-1',
        data: {
          kind: 'task',
          title: 'Fix login bug',
          task: { requirement: 'Investigate unicorn-token and patch auth.' },
          note: null,
        },
      }),
      asNode({
        id: 'note-1',
        data: {
          kind: 'note',
          title: 'note',
          task: null,
          note: { text: 'unrelated' },
        },
      }),
    ]

    const hits = searchWorkspace({
      nodes,
      spaces: [],
      query: 'unicorn-token',
      workspacePath: '/repo',
      worktreeInfoByPath: null,
      pullRequestsByBranch: null,
    })
    expect(hits.map(hit => hit.nodeId).filter(Boolean)).toEqual(['task-1'])
    expect(hits[0]?.kind).toBe('task')
  })

  it('matches note text', () => {
    const nodes = [
      asNode({
        id: 'note-1',
        data: {
          kind: 'note',
          title: 'note',
          task: null,
          note: { text: 'Remember to check banana-token in the logs.' },
        },
      }),
    ]

    const hits = searchWorkspace({
      nodes,
      spaces: [],
      query: 'banana-token',
      workspacePath: '/repo',
      worktreeInfoByPath: null,
      pullRequestsByBranch: null,
    })
    expect(hits.map(hit => hit.nodeId).filter(Boolean)).toEqual(['note-1'])
    expect(hits[0]?.kind).toBe('note')
  })
})
