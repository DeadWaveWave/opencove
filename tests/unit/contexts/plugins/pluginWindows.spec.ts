import { describe, expect, it } from 'vitest'
import {
  listPluginWindows,
  planPluginWindowOpen,
  resolvePluginWindow,
} from '../../../../src/contexts/workspace/application/nodeControl/pluginWindows'
import type { NodeControlAppState } from '../../../../src/contexts/workspace/application/nodeControl/nodeControlState'
import type { PluginManifest } from '../../../../src/contexts/plugins/domain/pluginTypes'

const single: PluginManifest = {
  id: 'sample',
  version: '1.0.0',
  displayName: 'Sample',
  description: 'Fixture',
  source: 'local',
  enabled: true,
  status: 'ready',
  nodeKinds: ['sample'],
  actionBar: true,
  contextMenu: true,
  view: {
    entry: 'index.html',
    instances: 'single',
    width: 440,
    height: 320,
    minWidth: 320,
    minHeight: 220,
  },
}
function initial(): NodeControlAppState {
  return {
    formatVersion: 1,
    settings: {},
    activeWorkspaceId: 'first',
    workspaces: ['first', 'second'].map(id => ({
      id,
      name: id,
      path: '/repo',
      worktreesRoot: '/repo',
      pullRequestBaseBranchOptions: [],
      environmentVariables: {},
      spaceArchiveRecords: [],
      viewport: { x: 0, y: 0, zoom: 1 },
      isMinimapVisible: false,
      activeSpaceId: null,
      nodes: [],
      spaces: [],
    })),
  }
}
const now = '2026-09-30T00:00:00Z'
describe('durable plugin window identity', () => {
  it('requires a project for creation when multiple projects exist, regardless of local navigation', () => {
    for (const activeWorkspaceId of ['first', 'second']) {
      expect(() =>
        planPluginWindowOpen(
          { ...initial(), activeWorkspaceId },
          single,
          { pluginId: 'sample' },
          now,
        ),
      ).toThrow('Specify --project')
    }
  })
  it('requires an explicit project even when only one project exists', () => {
    const state = initial()
    state.workspaces = [state.workspaces[1]]
    expect(() => planPluginWindowOpen(state, single, { pluginId: 'sample' }, now)).toThrow(
      'Specify --project',
    )
  })
  it('requires a project to exist before creating a window', () => {
    expect(() =>
      planPluginWindowOpen(
        { ...initial(), workspaces: [] },
        single,
        { pluginId: 'sample', projectId: 'first' },
        now,
      ),
    ).toThrow('Choose a project')
  })
  it('places beside compact icons using displayed dimensions without changing saved window size', () => {
    const multiple = { ...single, view: { ...single.view!, instances: 'multiple' as const } }
    const first = planPluginWindowOpen(
      initial(),
      multiple,
      { pluginId: 'sample', projectId: 'first', anchor: { x: 0, y: 0 } },
      now,
    )
    first.state.workspaces[0].collapsedNodeIds = [first.window.nodeId]
    const next = planPluginWindowOpen(
      first.state,
      multiple,
      { pluginId: 'sample', projectId: 'first', anchor: { x: 180, y: 0 } },
      now,
    )
    expect(next.state.workspaces[0].nodes[1].position).toEqual({ x: 180, y: 0 })
    expect(next.state.workspaces[0].nodes[0].width).toBe(440)
  })
  it('reuses a singleton across projects, preserves its title/location, and creates only after it was actually closed', () => {
    const first = planPluginWindowOpen(
      initial(),
      single,
      { pluginId: 'sample', projectId: 'first' },
      now,
    )
    first.state.workspaces[0].nodes[0].title = 'Renamed window'
    const next = planPluginWindowOpen(
      { ...first.state, activeWorkspaceId: 'second' },
      single,
      { pluginId: 'sample', projectId: 'second' },
      now,
    )
    expect(next.created).toBe(false)
    expect(next.window).toMatchObject({
      nodeId: first.window.nodeId,
      projectId: 'first',
      title: 'Renamed window',
    })
    expect(next.state).toBeDefined()
    expect(listPluginWindows(next.state, 'sample')).toHaveLength(1)
    expect(planPluginWindowOpen(next.state, single, { pluginId: 'sample' }, now).window).toEqual(
      next.window,
    )
    const closed = {
      ...next.state,
      workspaces: next.state.workspaces.map(workspace => ({ ...workspace, nodes: [] })),
    }
    const reopened = planPluginWindowOpen(
      closed,
      single,
      { pluginId: 'sample', projectId: 'second' },
      now,
    )
    expect(reopened.created).toBe(true)
    expect(reopened.window.projectId).toBe('second')
    expect(reopened.window.nodeId).not.toBe(first.window.nodeId)
  })
  it('requires explicit node identity for multiple-window commands even when there is only one saved node', () => {
    const multiple = { ...single, view: { ...single.view!, instances: 'multiple' as const } }
    const first = planPluginWindowOpen(
      initial(),
      multiple,
      { pluginId: 'sample', projectId: 'first' },
      now,
    )
    expect(() =>
      resolvePluginWindow(first.state, multiple, { pluginId: 'sample' }, 'command'),
    ).toThrow('Specify --node')
    expect(
      resolvePluginWindow(
        first.state,
        multiple,
        { pluginId: 'sample', nodeId: first.window.nodeId },
        'command',
      ),
    ).toEqual(first.window)
    const second = planPluginWindowOpen(
      first.state,
      multiple,
      { pluginId: 'sample', projectId: 'first' },
      now,
    )
    expect(listPluginWindows(second.state, 'sample')).toHaveLength(2)
    expect(() =>
      resolvePluginWindow(
        second.state,
        multiple,
        { pluginId: 'other', nodeId: 'missing' },
        'command',
      ),
    ).toThrow('does not belong')
  })
  it('retains legacy duplicate nodes when a manifest changes to single instead of deleting user data', () => {
    const multiple = { ...single, view: { ...single.view!, instances: 'multiple' as const } }
    const first = planPluginWindowOpen(
      initial(),
      multiple,
      { pluginId: 'sample', projectId: 'first' },
      now,
    )
    const second = planPluginWindowOpen(
      first.state,
      multiple,
      { pluginId: 'sample', projectId: 'first' },
      now,
    )
    expect(() => planPluginWindowOpen(second.state, single, { pluginId: 'sample' }, now)).toThrow(
      'More than one saved window',
    )
    expect(
      planPluginWindowOpen(
        second.state,
        single,
        { pluginId: 'sample', nodeId: first.window.nodeId },
        now,
      ).created,
    ).toBe(false)
    expect(listPluginWindows(second.state, 'sample')).toHaveLength(2)
  })
  it('rejects packages without a view and invalid project/Space targets', () => {
    expect(() =>
      planPluginWindowOpen(
        initial(),
        { ...single, view: undefined, nodeKinds: [] },
        { pluginId: 'sample' },
        now,
      ),
    ).toThrow('no window')
    expect(() =>
      planPluginWindowOpen(initial(), single, { pluginId: 'sample', projectId: 'missing' }, now),
    ).toThrow('Choose a project')
    expect(() =>
      planPluginWindowOpen(
        initial(),
        single,
        { pluginId: 'sample', projectId: 'first', spaceId: 'missing' },
        now,
      ),
    ).toThrow('Space')
  })
  it('grows the target Space and its ancestors without moving existing nodes', () => {
    const state = initial()
    state.workspaces[0].spaces = ['parent', 'child'].map((id, index) => ({
      id,
      name: id,
      directoryPath: '/repo',
      targetMountId: null,
      parentSpaceId: index ? 'parent' : null,
      labelColor: null,
      nodeIds: [],
      rect: { x: 0, y: 0, width: 120, height: 100 },
    }))
    const result = planPluginWindowOpen(
      state,
      single,
      { pluginId: 'sample', projectId: 'first', spaceId: 'child' },
      now,
    )
    const [parent, child] = result.state.workspaces[0].spaces
    expect(child.nodeIds).toEqual([result.window.nodeId])
    expect(parent.nodeIds).toEqual([])
    expect(child.rect!.width).toBeGreaterThan(440)
    expect(parent.rect!.width).toBeGreaterThan(child.rect!.width)
    expect(state.workspaces[0].nodes).toHaveLength(0)
  })
})
