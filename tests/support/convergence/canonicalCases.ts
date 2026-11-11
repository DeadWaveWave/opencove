import type { PersistedAppState } from '@contexts/workspace/presentation/renderer/types'
import {
  reorderRootSpacesWithinPinGroup,
  setRootSpacePinned,
} from '@contexts/workspace/domain/workspaceSpacePinning'
export const canonicalCases: Array<{ field: string; change: (s: PersistedAppState) => void }> = [
  {
    field: 'spaces.sortOrder/reorder',
    change: s => {
      s.workspaces[0].spaces = reorderRootSpacesWithinPinGroup(
        s.workspaces[0].spaces,
        'second',
        'space',
      )
    },
  },
  {
    field: 'spaces.sortOrder/pin',
    change: s => {
      s.workspaces[0].spaces = setRootSpacePinned(s.workspaces[0].spaces, 'second', true)
    },
  },
  {
    field: 'spaces.defaults',
    change: s => {
      for (const key of [
        'parentSpaceId',
        'targetMountId',
        'boundary',
        'pinned',
        'labelColor',
        'rect',
      ]) {
        Reflect.deleteProperty(s.workspaces[0].spaces[0], key)
      }
    },
  },
  {
    field: 'spaces.sortOrder/integer',
    change: s => {
      s.workspaces[0].spaces[0].sortOrder = 2.75
    },
  },
  {
    field: 'spaces.links/ordered',
    change: s => {
      s.workspaces[0].spaces[0].nodeIds = ['terminal', 'agent']
    },
  },
  {
    field: 'nodes.nullability/defaults',
    change: s => {
      for (const n of s.workspaces[0].nodes) {
        for (const key of [
          'runtimeKind',
          'sessionId',
          'profileId',
          'titlePinnedByUser',
          'titleIsLiteral',
          'terminalGeometry',
          'workerBinding',
          'terminalProviderHint',
          'labelColorOverride',
          'sidebarSortOrder',
          'executionDirectory',
          'expectedDirectory',
          'status',
          'startedAt',
          'endedAt',
          'exitCode',
          'lastError',
          'task',
        ]) {
          Reflect.deleteProperty(n, key)
        }
      }
    },
  },
  {
    field: 'nodes.optionalStrings',
    change: s => {
      s.workspaces[0].nodes[0].sessionId = ' runtime '
      s.workspaces[0].nodes[0].profileId = ' profile '
    },
  },
  {
    field: 'nodes.sidebarSortOrder',
    change: s => {
      s.workspaces[0].nodes[0].sidebarSortOrder = 4.75
    },
  },
  {
    field: 'nodes.geometry',
    change: s => {
      s.workspaces[0].nodes[1].terminalGeometry = { cols: 1001, rows: 2000 }
    },
  },
  {
    field: 'nodes.scrollback/separate-owner',
    change: s => {
      s.workspaces[0].nodes[1].scrollback = 'Separate terminal history'
    },
  },
  {
    field: 'workspace.defaults',
    change: s => {
      for (const key of [
        'iconId',
        'worktreesRoot',
        'environmentVariables',
        'pullRequestBaseBranchOptions',
        'spaceArchiveRecords',
      ]) {
        Reflect.deleteProperty(s.workspaces[0], key)
      }
    },
  },
  {
    field: 'workspace.pullRequestBaseBranchOptions',
    change: s => {
      s.workspaces[0].pullRequestBaseBranchOptions = [' main ', 'main', 'develop']
    },
  },
  {
    field: 'workspace.environmentVariables',
    change: s => {
      s.workspaces[0].environmentVariables = { ' LANG ': 'en', PATH: '/bin' }
    },
  },
  {
    field: 'workspace.collapse/sets',
    change: s => {
      s.workspaces[0].collapsedNodeIds = [' agent ', 'agent']
      s.workspaces[0].collapsedSpaceIds = ['space', 'space']
    },
  },
  {
    field: 'view/viewport+minimap+activeSpace+activeWorkspace',
    change: s => {
      s.activeWorkspaceId = 'project'
      s.workspaces[0].viewport = { x: 876, y: 123, zoom: 2 }
      s.workspaces[0].isMinimapVisible = false
      s.workspaces[0].activeSpaceId = 'second'
    },
  },
  {
    field: 'json/settings/keyorder',
    change: s => {
      s.settings.sidebarCollapsedSpaceGroupIds = { 'project:space': true }
      s.workspaces[0].environmentVariables = { Z: 'z', A: 'a' }
    },
  },
  {
    field: 'workspace.ordered-array',
    change: s => {
      s.workspaces.unshift({
        ...structuredClone(s.workspaces[0]),
        id: 'other',
        name: 'Other',
        nodes: [],
        spaces: [],
      })
    },
  },
  {
    field: 'nodes.unordered-rows',
    change: s => {
      s.workspaces[0].nodes.reverse()
    },
  },
  {
    field: 'ids.normalized',
    change: s => {
      s.workspaces[0].nodes[0].id = ' agent '
    },
  },
  {
    field: 'workspace.environmentVariables/limit',
    change: s => {
      s.workspaces[0].environmentVariables = Object.fromEntries(
        Array.from({ length: 105 }, (_, i) => ['VAR' + i, String(i)]),
      )
    },
  },
  {
    field: 'workspace.pullRequestBaseBranchOptions/limit',
    change: s => {
      s.workspaces[0].pullRequestBaseBranchOptions = Array.from(
        { length: 55 },
        (_, i) => 'branch' + i,
      )
    },
  },
  {
    field: 'archive.JSON/defaults+ordered+limit',
    change: s => {
      s.workspaces[0].spaceArchiveRecords = Array.from({ length: 52 }, (_, i) => ({
        id: 'archive' + i,
        archivedAt: '2026-11-01T00:00:00Z',
        git: null,
        space: {
          id: 'saved',
          name: 'Saved',
          directoryPath: '/tmp/convergence',
          labelColor: null,
          rect: null,
        },
        nodes: [
          {
            id: 'saved-note',
            kind: 'note',
            title: 'Note',
            text: 'Saved',
            frame: null,
            labelColorOverride: null,
          },
        ],
      }))
    },
  },
  {
    field: 'settings.JSON/ordered-arrays',
    change: s => {
      s.settings.agentProviderOrder.reverse()
    },
  },
  {
    field: 'node.task.JSON/link-normalization',
    change: s => {
      s.workspaces[0].nodes.push({
        id: 'task',
        kind: 'task',
        agent: null,
        status: null,
        startedAt: null,
        endedAt: null,
        exitCode: null,
        lastError: null,
        scrollback: null,
        title: 'Task',
        position: { x: 0, y: 0 },
        width: 400,
        height: 300,
        task: {
          requirement: 'Review',
          linkedAgentNodeId: ' agent ',
          status: 'todo',
          priority: 'medium',
          tags: [],
          agentSessions: [],
          lastRunAt: null,
          autoGeneratedTitle: false,
          createdAt: null,
          updatedAt: null,
        },
      })
      const task = s.workspaces[0].nodes.at(-1)!.task!
      for (const key of [
        'status',
        'priority',
        'tags',
        'agentSessions',
        'lastRunAt',
        'autoGeneratedTitle',
        'createdAt',
        'updatedAt',
      ]) {
        Reflect.deleteProperty(task, key)
      }
    },
  },
  {
    field: 'node.non-wire-fields',
    change: s => {
      Reflect.set(s.workspaces[0].nodes[0], 'runtimeSessionBinding', {
        phase: 'publishing',
        sessionId: 'runtime',
      })
    },
  },
]
export function addSecondSpace(s: PersistedAppState) {
  if (!s.workspaces[0].spaces.some(space => space.id === 'second')) {
    s.workspaces[0].spaces.push({
      id: 'second',
      name: 'Second',
      directoryPath: '/tmp/convergence',
      targetMountId: null,
      labelColor: null,
      nodeIds: [],
      rect: null,
      sortOrder: 1,
    })
  }
  s.workspaces[0].spaces[0].sortOrder = 0
}
