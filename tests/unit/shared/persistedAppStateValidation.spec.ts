import { isPersistedAppState } from '@shared/sync/persistedAppStateValidation'

function validState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    settings: {},
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/repo',
        worktreesRoot: '/repo',
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        activeSpaceId: 'space-1',
        spaceArchiveRecords: [],
        nodes: [
          {
            id: 'node-1',
            title: 'Terminal',
            position: { x: 10, y: 20 },
            width: 640,
            height: 480,
            kind: 'terminal',
            sidebarSortOrder: null,
            workerBinding: { endpointId: 'local', mountId: null },
            status: null,
            startedAt: null,
            endedAt: null,
            exitCode: null,
            lastError: null,
            scrollback: null,
            agent: null,
            task: null,
          },
        ],
        spaces: [
          {
            id: 'space-1',
            name: 'Space',
            directoryPath: '/repo',
            targetMountId: null,
            parentSpaceId: null,
            boundary: {
              allowedMountIds: ['mount-1'],
              scopesByMountId: {
                'mount-1': { rootPath: '/repo', rootUri: 'file:///repo' },
              },
              allowedPluginIds: null,
              capabilities: null,
              trustLevel: 'trusted',
            },
            sortOrder: 0,
            pinned: false,
            labelColor: null,
            nodeIds: [],
            rect: null,
          },
        ],
      },
    ],
  }
}

describe('persisted app-state boundary validation', () => {
  it('accepts the complete shared contract', () => {
    expect(isPersistedAppState(validState())).toBe(true)
  })

  it('rejects a space that omits its required label color', () => {
    const state = validState()
    delete (state.workspaces[0]!.spaces[0] as { labelColor?: unknown }).labelColor

    expect(isPersistedAppState(state)).toBe(false)
  })

  it('rejects malformed optional space boundary structures before merge code can trust them', () => {
    const state = validState()
    state.workspaces[0]!.spaces[0]!.boundary = {} as never

    expect(isPersistedAppState(state)).toBe(false)
  })

  it('rejects malformed optional space fields', () => {
    const state = validState()
    state.workspaces[0]!.spaces[0]!.pinned = 'yes' as never

    expect(isPersistedAppState(state)).toBe(false)
  })

  it('rejects unsupported workspace icon identifiers', () => {
    const state = validState()
    state.workspaces[0]!.iconId = 'unknown-icon'

    expect(isPersistedAppState(state)).toBe(false)
  })

  it('rejects malformed durable node ownership', () => {
    const state = validState()
    state.workspaces[0]!.nodes[0]!.workerBinding.mountId = 42 as never

    expect(isPersistedAppState(state)).toBe(false)
  })

  it('rejects non-finite durable node ordering', () => {
    const state = validState()
    state.workspaces[0]!.nodes[0]!.sidebarSortOrder = Number.NaN

    expect(isPersistedAppState(state)).toBe(false)
  })
})
