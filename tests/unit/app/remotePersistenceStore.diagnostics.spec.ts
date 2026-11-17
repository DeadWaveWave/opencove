import { afterEach, describe, expect, it, vi } from 'vitest'
import { createRemotePersistenceStore } from '../../../src/app/main/controlSurface/remote/remotePersistenceStore'

const endpoint = { hostname: '127.0.0.1', port: 4310, token: 'test' }
const state = { formatVersion: 1, activeWorkspaceId: null, workspaces: [], settings: {} }
const storeError = {
  code: 'persistence.io_failed',
  debugMessage: 'SqliteError(SQLITE_BUSY): database is locked',
  details: { existing: true },
}
function respond(value: unknown) {
  return { status: 200, text: async () => JSON.stringify(value) }
}
function envelope(value: unknown) {
  return respond({ __opencoveControlEnvelope: true, ok: true, value })
}
afterEach(() => vi.unstubAllGlobals())

describe('remote save diagnostic stages', () => {
  it('tags a returned Worker store failure without changing its classification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => envelope({ ok: false, reason: 'io', error: storeError })),
    )
    const store = createRemotePersistenceStore(async () => endpoint)
    expect(await store.writeWorkspaceStateRaw('{}')).toEqual({
      ok: false,
      reason: 'io',
      outcome: 'unknown',
      error: { ...storeError, details: { existing: true, stage: 'worker-store' } },
    })
  })

  it.each(['raw', 'app'] as const)(
    'tags %s envelope rejections and preserves their error',
    async mode => {
      const error = { ...storeError, code: 'common.forbidden' }
      const fetchMock = vi.fn(async () =>
        respond({ __opencoveControlEnvelope: true, ok: false, error }),
      )
      if (mode === 'app') {
        fetchMock.mockResolvedValueOnce(envelope({ revision: 0, state: null }))
      }
      vi.stubGlobal('fetch', fetchMock)
      const store = createRemotePersistenceStore(async () => endpoint)
      const result =
        mode === 'raw' ? await store.writeWorkspaceStateRaw('{}') : await store.writeAppState(state)
      expect(result).toEqual({
        ok: false,
        reason: 'io',
        outcome: 'rejected',
        error: { ...error, details: { existing: true, stage: 'worker-envelope' } },
      })
    },
  )

  it('recognizes the store I/O error carried by the revisioned write envelope', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(envelope({ revision: 0, state: null }))
        .mockResolvedValueOnce(
          respond({ __opencoveControlEnvelope: true, ok: false, error: storeError }),
        ),
    )
    expect(await createRemotePersistenceStore(async () => endpoint).writeAppState(state)).toEqual({
      ok: false,
      reason: 'io',
      outcome: 'unknown',
      error: { ...storeError, details: { existing: true, stage: 'worker-store' } },
    })
  })

  it.each(['raw', 'app'] as const)('tags an unavailable endpoint for %s writes', async mode => {
    const store = createRemotePersistenceStore(async () => null)
    const result =
      mode === 'raw' ? await store.writeWorkspaceStateRaw('{}') : await store.writeAppState(state)
    expect(result).toMatchObject({
      ok: false,
      reason: 'io',
      outcome: 'notSubmitted',
      error: {
        debugMessage: 'Error: Remote worker endpoint unavailable.',
        details: { stage: 'endpoint-unavailable' },
      },
    })
  })

  it('tags a resolver exception before submission without changing its error or outcome', async () => {
    const store = createRemotePersistenceStore(async () => {
      throw new Error('resolver failed')
    })
    expect(await store.writeAppState(state)).toMatchObject({
      ok: false,
      reason: 'io',
      outcome: 'notSubmitted',
      error: { debugMessage: 'Error: resolver failed', details: { stage: 'endpoint-unavailable' } },
    })
  })

  it('keeps the envelope tag when a preparatory read rejects the write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respond({
          __opencoveControlEnvelope: true,
          ok: false,
          error: { code: 'common.forbidden' },
        }),
      ),
    )
    expect(
      await createRemotePersistenceStore(async () => endpoint).writeAppState(state),
    ).toMatchObject({
      ok: false,
      reason: 'io',
      outcome: 'rejected',
      error: { details: { stage: 'worker-envelope' } },
    })
  })

  it.each(['raw', 'app'] as const)(
    'tags transport failures after submitting %s writes as unknown',
    async mode => {
      const fetchMock = vi.fn().mockRejectedValue(new Error('connection reset'))
      if (mode === 'app') {
        fetchMock.mockResolvedValueOnce(envelope({ revision: 0, state: null }))
      }
      vi.stubGlobal('fetch', fetchMock)
      const store = createRemotePersistenceStore(async () => endpoint)
      const result =
        mode === 'raw' ? await store.writeWorkspaceStateRaw('{}') : await store.writeAppState(state)
      expect(result).toMatchObject({
        ok: false,
        reason: 'io',
        outcome: 'unknown',
        error: {
          debugMessage: 'Error: connection reset',
          details: { stage: 'transport' },
        },
      })
    },
  )
})
