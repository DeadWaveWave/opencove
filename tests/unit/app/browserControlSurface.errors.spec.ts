import { afterEach, expect, it, vi } from 'vitest'
import { invokeBrowserControlSurface } from '@app/renderer/browser/browserControlSurface'
import { createBrowserPersistenceApi } from '@app/renderer/browser/browserOpenCoveApi.persistence'
import { OpenCoveAppError } from '@shared/errors/appError'
import { persistenceWriteFailure } from '@shared/sync/persistenceWriteOutcome'
import { DEFAULT_AGENT_SETTINGS } from '@contexts/settings/domain/agentSettings'
afterEach(() => vi.unstubAllGlobals())
const response = (value: unknown) => new Response(JSON.stringify(value))
it.each(['plugin.example', 'node.get'])(
  'revives actual HTTP application failure envelopes for %s',
  async id => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        response({
          __opencoveControlEnvelope: true,
          ok: false,
          error: {
            code: 'common.forbidden',
            debugMessage: 'SECRET',
            details: { managedClaudeLaunch: true, phase: 'afterSpawn' },
          },
        }),
      ),
    )
    const error = await invokeBrowserControlSurface({ kind: 'query', id, payload: {} }).catch(
      caught => caught,
    )
    expect(error).toBeInstanceOf(OpenCoveAppError)
    expect(error.details).toEqual({ managedClaudeLaunch: true, phase: 'afterSpawn' })
    expect(JSON.stringify(error)).not.toContain('SECRET')
  },
)
it.each([{}, { __opencoveControlEnvelope: true, ok: false, error: { code: 'future.code' } }])(
  'keeps malformed HTTP results uncertain',
  async result => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response(result)),
    )
    const error = await invokeBrowserControlSurface({
      kind: 'command',
      id: 'sync.writeState',
      payload: {},
    }).catch(caught => caught)
    expect(error).not.toBeInstanceOf(OpenCoveAppError)
    expect(persistenceWriteFailure(error).outcome).toBe('unknown')
  },
)
it('preserves native browser fetch errors', async () => {
  const error = new TypeError('Failed to fetch')
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(error))
  await expect(
    invokeBrowserControlSurface({ kind: 'query', id: 'system.ping', payload: {} }),
  ).rejects.toBe(error)
})
it.each([true, false])(
  'bounds revision recovery and avoids retry for unrelated invalid state (conflict=%s)',
  async conflict => {
    const state = {
      formatVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
      settings: DEFAULT_AGENT_SETTINGS,
    }
    const calls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url, init) => {
        const request = JSON.parse(init.body)
        calls.push(request.id)
        return response(
          request.id === 'sync.state'
            ? { __opencoveControlEnvelope: true, ok: true, value: { revision: 2, state } }
            : {
                __opencoveControlEnvelope: true,
                ok: false,
                error: {
                  code: 'persistence.invalid_state',
                  debugMessage: conflict
                    ? 'sync.writeState revision conflict (base=1, current=2)'
                    : 'unrelated revision conflict SECRET',
                },
              },
        )
      }),
    )
    const api = createBrowserPersistenceApi()
    const result = await api.writeAppState({ state, baseRevision: 1 })
    expect(calls.filter(id => id === 'sync.writeState')).toHaveLength(1)
    expect(calls.filter(id => id === 'sync.state')).toHaveLength(conflict ? 1 : 0)
    expect(result.ok).toBe(conflict)
  },
)
