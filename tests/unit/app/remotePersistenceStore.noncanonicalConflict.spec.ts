import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'
import { DEFAULT_AGENT_SETTINGS } from '../../../src/contexts/settings/domain/agentSettings'

function createMergeState(positionX: number, revisionName: string) {
  return {
    formatVersion: 1,
    activeWorkspaceId: 'workspace-1',
    workspaces: [
      {
        id: 'workspace-1',
        name: 'Workspace',
        path: '/workspace',
        worktreesRoot: '/worktrees',
        nodes: [
          {
            id: 'node-1',
            title: 'Terminal',
            position: { x: positionX, y: 0 },
            width: 400,
            height: 300,
            kind: 'terminal',
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
        viewport: { x: 0, y: 0, zoom: 1 },
        isMinimapVisible: true,
        spaces: [],
        activeSpaceId: null,
        spaceArchiveRecords: [],
      },
    ],
    settings: { ...DEFAULT_AGENT_SETTINGS, releaseNotesSeenVersion: revisionName },
  }
}

function response(value: unknown, status = 200) {
  return { text: async () => JSON.stringify(value), status }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('remote persistence conflict validation', () => {
  it('preserves a legacy raw read while privately normalizing merge authority', async () => {
    const legacyState = {
      formatVersion: 1,
      activeWorkspaceId: 'workspace-legacy',
      workspaces: [
        {
          id: 'workspace-legacy',
          name: 'Legacy workspace',
          path: '/legacy',
          nodes: [
            {
              id: 'terminal-legacy',
              title: 'Legacy terminal',
              position: { x: 0, y: 0 },
              width: 400,
              height: 300,
              kind: 'terminal',
            },
          ],
        },
      ],
      settings: { language: 'zh-CN' },
    }
    const fetchMock = vi.fn().mockResolvedValue(
      response({
        __opencoveControlEnvelope: true,
        ok: true,
        value: { revision: 4, state: legacyState },
      }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).resolves.toEqual(legacyState)
  })

  it.each([
    {
      label: 'malformed node ownership',
      corrupt: (state: ReturnType<typeof createMergeState>) => {
        state.workspaces[0]!.nodes[0]!.workerBinding = {
          endpointId: 'local',
          mountId: 42,
        }
      },
    },
    {
      label: 'noncanonical settings',
      corrupt: (state: ReturnType<typeof createMergeState>) => {
        const settings = state.settings as { language: unknown }
        settings.language = 'invalid'
      },
    },
  ])('does not retry $label as an unmerged overwrite', async ({ corrupt }) => {
    const initialState = createMergeState(0, 'initial')
    const latestState = createMergeState(10, 'latest')
    const localState = createMergeState(0, 'local')
    corrupt(localState)
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        response({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { revision: 7, state: initialState },
        }),
      )
      .mockResolvedValueOnce(
        response(
          {
            __opencoveControlEnvelope: true,
            ok: false,
            error: { code: 'persistence.invalid_state', debugMessage: 'revision conflict' },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(
        response({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { revision: 8, state: latestState },
        }),
      )
      .mockResolvedValueOnce(
        response({
          __opencoveControlEnvelope: true,
          ok: true,
          value: { revision: 9 },
        }),
      )
    vi.stubGlobal('fetch', fetchMock)
    const store = createRemotePersistenceStore(async () => ({
      hostname: '127.0.0.1',
      port: 4310,
      token: 'token-1',
    }))

    await expect(store.readAppState()).resolves.toEqual(initialState)
    await expect(store.writeAppState(localState)).resolves.toMatchObject({
      ok: false,
      reason: 'io',
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})
