import { isPersistedAppState } from '@shared/sync/persistedAppStateValidation'

type TestSettings = { language: 'en' }

function isTestSettings(value: unknown): value is TestSettings {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).language === 'en'
  )
}

function isValidState(value: unknown): boolean {
  return isPersistedAppState(value, isTestSettings)
}

function validState() {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    settings: { language: 'en' as const },
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
    expect(isValidState(validState())).toBe(true)
  })

  it('requires the caller-owned settings specialization to accept the payload', () => {
    const state = validState()
    state.settings = { language: 'fr' as never }

    expect(isValidState(state)).toBe(false)
  })

  it('rejects a space that omits its required label color', () => {
    const state = validState()
    delete (state.workspaces[0]!.spaces[0] as { labelColor?: unknown }).labelColor

    expect(isValidState(state)).toBe(false)
  })

  it('rejects malformed optional space boundary structures before merge code can trust them', () => {
    const state = validState()
    state.workspaces[0]!.spaces[0]!.boundary = {} as never

    expect(isValidState(state)).toBe(false)
  })

  it('rejects malformed optional space fields', () => {
    const state = validState()
    state.workspaces[0]!.spaces[0]!.pinned = 'yes' as never

    expect(isValidState(state)).toBe(false)
  })

  it('rejects unsupported workspace icon identifiers', () => {
    const state = validState()
    state.workspaces[0]!.iconId = 'unknown-icon'

    expect(isValidState(state)).toBe(false)
  })

  it('rejects malformed durable node ownership', () => {
    const state = validState()
    state.workspaces[0]!.nodes[0]!.workerBinding.mountId = 42 as never

    expect(isValidState(state)).toBe(false)
  })

  it('rejects non-finite durable node ordering', () => {
    const state = validState()
    state.workspaces[0]!.nodes[0]!.sidebarSortOrder = Number.NaN

    expect(isValidState(state)).toBe(false)
  })

  it.each([
    ['sessionId', 42],
    ['titlePinnedByUser', 'yes'],
    ['profileId', 42],
    ['runtimeKind', 'unsupported'],
    ['terminalGeometry', { cols: 0, rows: 24 }],
    ['terminalProviderHint', 'unsupported'],
    ['labelColorOverride', 'pink'],
    ['executionDirectory', 42],
    ['expectedDirectory', 42],
  ])('rejects malformed optional durable node field %s', (field, invalidValue) => {
    const state = validState()
    Object.assign(state.workspaces[0]!.nodes[0]!, { [field]: invalidValue })

    expect(isValidState(state)).toBe(false)
  })

  it('rejects a malformed terminal Agent binding before merge code can preserve it', () => {
    const state = validState()
    state.workspaces[0]!.nodes[0]!.agent = {
      provider: 'unsupported',
      resumeSessionId: 42,
    }

    expect(isValidState(state)).toBe(false)
  })

  it('accepts enumerated legacy task fields when the renderer normalizer can supply them', () => {
    const state = validState()
    Object.assign(state.workspaces[0]!.nodes[0]!, {
      kind: 'task',
      agent: null,
      task: {
        requirement: 'Verify persistence',
        status: 'todo',
        priority: 'medium',
        tags: [],
        linkedAgentNodeId: null,
        lastRunAt: null,
        autoGeneratedTitle: false,
      },
    })

    expect(isValidState(state)).toBe(true)
  })

  it('rejects malformed kind-specific task payloads', () => {
    const state = validState()
    Object.assign(state.workspaces[0]!.nodes[0]!, {
      kind: 'task',
      agent: null,
      task: {
        requirement: 'Verify persistence',
        status: 'todo',
        priority: 'medium',
        tags: [],
        agentSessions: [42],
      },
    })

    expect(isValidState(state)).toBe(false)
  })

  it('rejects malformed nested archive records', () => {
    const state = validState()
    state.workspaces[0]!.spaceArchiveRecords = [{ id: 'archive-without-snapshot' }]

    expect(isValidState(state)).toBe(false)
  })
})
