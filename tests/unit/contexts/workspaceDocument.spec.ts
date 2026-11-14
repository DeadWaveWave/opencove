import { describe, expect, it } from 'vitest'
import {
  applyWorkspaceDocument,
  toWorkspaceDocument,
} from '../../../src/contexts/workspace/presentation/renderer/store/workspaceDocument'
import type {
  WorkspaceSpaceState,
  WorkspaceState,
} from '../../../src/contexts/workspace/presentation/renderer/types'
import { pixelNode } from './workspacePixelLayer.fixtures'

function space(id: string, nodeIds: string[], parentSpaceId?: string): WorkspaceSpaceState {
  return {
    id,
    name: id,
    directoryPath: '/tmp/workspace',
    targetMountId: null,
    labelColor: null,
    nodeIds,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    ...(parentSpaceId ? { parentSpaceId } : {}),
  } as WorkspaceSpaceState
}

function workspace(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    id: 'workspace-1',
    name: 'Workspace',
    path: '/tmp/workspace',
    worktreesRoot: '/tmp/workspace',
    nodes: [pixelNode({ title: 'one' }), { ...pixelNode({ title: 'two' }), id: 'terminal-2' }],
    spaces: [space('space-1', ['terminal-1', 'terminal-2'])],
    activeSpaceId: 'space-1',
    spaceArchiveRecords: [],
    viewport: { x: 1, y: 2, zoom: 1 },
    isMinimapVisible: true,
    ...overrides,
  } as WorkspaceState
}

describe('workspaceDocument', () => {
  it('returns the workspace itself when no document field changed', () => {
    const source = workspace()
    expect(applyWorkspaceDocument(source, toWorkspaceDocument(source))).toBe(source)
  })

  it('treats an equal viewport value as unchanged', () => {
    const source = workspace()
    const next = { ...toWorkspaceDocument(source), viewport: { x: 1, y: 2, zoom: 1 } }
    expect(applyWorkspaceDocument(source, next)).toBe(source)
  })

  it('does not touch fields outside the document', () => {
    const source = workspace({ iconId: null, environmentVariables: { A: '1' } })
    const result = applyWorkspaceDocument(source, {
      ...toWorkspaceDocument(source),
      isMinimapVisible: false,
    })
    expect(result).toEqual({ ...source, isMinimapVisible: false })
    expect(result.environmentVariables).toBe(source.environmentVariables)
  })

  it('filters removed nodes out of every Space and drops an invalid activeSpaceId', () => {
    const source = workspace({
      spaces: [space('space-1', ['terminal-1']), space('space-2', ['terminal-2'])],
      activeSpaceId: 'space-1',
    })
    const document = toWorkspaceDocument(source)
    const result = applyWorkspaceDocument(source, {
      ...document,
      nodes: document.nodes.filter(node => node.id !== 'terminal-1'),
    })
    expect(result.spaces.map(item => item.nodeIds)).toEqual([[], ['terminal-2']])
    expect(result.activeSpaceId).toBe('space-1')

    const childActive = workspace({
      spaces: [space('space-1', []), space('child', ['terminal-1'], 'space-1')],
      activeSpaceId: 'child',
    })
    const childResult = applyWorkspaceDocument(childActive, {
      ...toWorkspaceDocument(childActive),
      nodes: [...childActive.nodes],
    })
    expect(childResult.activeSpaceId).toBeNull()
  })

  it('sanitizes a Spaces change and drops an activeSpaceId that no longer names a root Space', () => {
    const source = workspace()
    const result = applyWorkspaceDocument(source, {
      ...toWorkspaceDocument(source),
      spaces: [space('space-2', ['terminal-1', 'terminal-1'])],
    })
    expect(result.spaces[0].nodeIds).toEqual(['terminal-1'])
    expect(result.activeSpaceId).toBeNull()
    expect(result.nodes).toBe(source.nodes)
  })

  it('applies a nodes and Spaces change together, filtering the new Spaces by the new nodes', () => {
    const source = workspace()
    const document = toWorkspaceDocument(source)
    const result = applyWorkspaceDocument(source, {
      ...document,
      nodes: document.nodes.slice(0, 1),
      spaces: [space('space-1', ['terminal-1', 'terminal-2'])],
    })
    expect(result.nodes).toHaveLength(1)
    expect(result.spaces[0].nodeIds).toEqual(['terminal-1'])
  })

  it('takes an active Space change as given when nodes and Spaces are unchanged', () => {
    const source = workspace({ activeSpaceId: null })
    const result = applyWorkspaceDocument(source, {
      ...toWorkspaceDocument(source),
      activeSpaceId: 'space-1',
    })
    expect(result.activeSpaceId).toBe('space-1')
    expect(result.spaces).toBe(source.spaces)
  })
})
