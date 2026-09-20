import { describe, expect, it } from 'vitest'
import type { WorkspaceSpaceState } from '@contexts/workspace/presentation/renderer/types'
import {
  migrateLegacySpaceCollapse,
  type CanvasCollapseState,
} from '@contexts/workspace/presentation/renderer/utils/canvasCollapse'

function space(id: string, nodeIds: string[], parentSpaceId?: string): WorkspaceSpaceState {
  return {
    id,
    name: id,
    nodeIds,
    directoryPath: '/workspace',
    targetMountId: null,
    labelColor: null,
    parentSpaceId,
    rect: { x: 120, y: 80, width: 940, height: 720 },
  }
}

describe('legacy collapsed Space migration', () => {
  it('makes the old summary Space visible and collapses its windows without arranging it', () => {
    const spaces = [space('development', ['terminal', 'note']), space('review', ['review-agent'])]
    const state: CanvasCollapseState = {
      collapsedNodeIds: { 'existing-root-icon': true },
      collapsedSpaceIds: { development: true },
    }
    const previousSpaces = structuredClone(spaces)
    const previousState = structuredClone(state)

    expect(migrateLegacySpaceCollapse(state, spaces)).toEqual({
      collapsedNodeIds: { 'existing-root-icon': true, terminal: true, note: true },
      collapsedSpaceIds: {},
    })
    expect(spaces).toEqual(previousSpaces)
    expect(state).toEqual(previousState)
  })

  it('includes every descendant even when child Spaces precede their parent in storage', () => {
    const spaces = [
      space('grandchild', ['document'], 'child'),
      space('sibling', ['unrelated']),
      space('child', ['child-agent'], 'parent'),
      space('parent', ['parent-terminal']),
    ]
    const state: CanvasCollapseState = {
      collapsedNodeIds: { 'already-collapsed': true },
      collapsedSpaceIds: { parent: true, child: true },
    }

    expect(migrateLegacySpaceCollapse(state, spaces)).toEqual({
      collapsedNodeIds: {
        'already-collapsed': true,
        document: true,
        'child-agent': true,
        'parent-terminal': true,
      },
      collapsedSpaceIds: {},
    })
    expect(spaces.map(item => item.nodeIds)).toEqual([
      ['document'],
      ['unrelated'],
      ['child-agent'],
      ['parent-terminal'],
    ])
  })

  it('does not collapse a parent or sibling when only the child had a saved summary state', () => {
    const spaces = [
      space('parent', ['parent-terminal']),
      space('child', ['child-agent'], 'parent'),
      space('sibling', ['sibling-terminal'], 'parent'),
    ]
    expect(
      migrateLegacySpaceCollapse(
        { collapsedNodeIds: {}, collapsedSpaceIds: { child: true } },
        spaces,
      ),
    ).toEqual({ collapsedNodeIds: { 'child-agent': true }, collapsedSpaceIds: {} })
  })

  it.each([
    { spaces: [], legacyId: 'deleted' },
    { spaces: [space('empty', [])], legacyId: 'empty' },
    { spaces: [space('retained', ['visible'])], legacyId: 'deleted' },
  ])('clears an empty or deleted legacy Space ($legacyId)', ({ spaces, legacyId }) => {
    const state: CanvasCollapseState = {
      collapsedNodeIds: { 'existing-icon': true },
      collapsedSpaceIds: { [legacyId]: true },
    }
    expect(migrateLegacySpaceCollapse(state, spaces)).toEqual({
      collapsedNodeIds: { 'existing-icon': true },
      collapsedSpaceIds: {},
    })
  })

  it('is idempotent and preserves the original state reference when no legacy Space remains', () => {
    const spaces = [space('development', ['terminal'])]
    const current: CanvasCollapseState = {
      collapsedNodeIds: { terminal: true },
      collapsedSpaceIds: {},
    }
    expect(migrateLegacySpaceCollapse(current, spaces)).toBe(current)

    const migrated = migrateLegacySpaceCollapse(
      { collapsedNodeIds: {}, collapsedSpaceIds: { development: true } },
      spaces,
    )
    expect(migrateLegacySpaceCollapse(migrated, spaces)).toBe(migrated)
  })
})
