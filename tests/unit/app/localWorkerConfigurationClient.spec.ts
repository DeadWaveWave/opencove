import { afterEach, describe, expect, it, vi } from 'vitest'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'
import {
  invokeLocalWorkerConfiguration,
  normalizeHomeWorkerConfigurationFailureDetails,
  normalizeHomeWorkerConfigurationSnapshot,
} from '../../../src/app/main/worker/localWorkerConfigurationClient'

function workerConnection() {
  return {
    version: 1,
    pid: 1,
    hostname: '127.0.0.1',
    port: 16661,
    token: 'token',
    createdAt: '2026-08-31T00:00:00.000Z',
    appVersion: null,
    startedBy: 'desktop' as const,
  }
}

function validSnapshot() {
  return {
    config: {
      version: 1,
      mode: 'local',
      remote: null,
      webUi: { enabled: true, port: 16661, exposeOnLan: false, passwordSet: false },
      updatedAt: '2026-08-31T00:00:00.000Z',
    },
    webAccess: {
      state: 'active',
      generation: 1,
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 16661,
      passwordRequired: false,
      drainingGenerations: [],
    },
  }
}

describe('local Worker configuration response validation', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('normalizes a complete configuration snapshot', () => {
    expect(normalizeHomeWorkerConfigurationSnapshot(validSnapshot())).toEqual(validSnapshot())
  })

  it('preserves degraded listener admission as an explicit runtime state', () => {
    const value = validSnapshot()
    const degraded = {
      ...value,
      webAccess: {
        ...value.webAccess,
        state: 'degraded',
        error: 'rollback bind failed',
      },
    }

    expect(normalizeHomeWorkerConfigurationSnapshot(degraded).webAccess).toEqual(degraded.webAccess)
  })

  it.each([
    {
      path: 'generation',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.webAccess.generation = -1),
    },
    {
      path: 'active port',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.webAccess.port = 0),
    },
    {
      path: 'hostname',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.webAccess.hostname = ''),
    },
    {
      path: 'web config port',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.config.webUi.port = 70000),
    },
    {
      path: 'LAN password',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.config.webUi.exposeOnLan = true),
    },
    {
      path: 'revision',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.config.updatedAt = 'not-a-date'),
    },
    {
      path: 'non-canonical revision',
      mutate: (value: ReturnType<typeof validSnapshot>) => (value.config.updatedAt = '2026-08-31'),
    },
  ])('rejects malformed $path values', ({ mutate }) => {
    const value = validSnapshot()
    mutate(value)
    expect(() => normalizeHomeWorkerConfigurationSnapshot(value)).toThrow(OpenCoveAppError)
  })

  it('rejects remote mode without a complete remote endpoint', () => {
    const value = validSnapshot()
    value.config.mode = 'remote'
    expect(() => normalizeHomeWorkerConfigurationSnapshot(value)).toThrow(OpenCoveAppError)
  })

  it('normalizes typed configuration failure details', () => {
    expect(
      normalizeHomeWorkerConfigurationFailureDetails({
        configurationSnapshot: validSnapshot(),
        ignoredTransportField: true,
      }),
    ).toEqual({ configurationSnapshot: validSnapshot() })
  })

  it.each([
    null,
    {},
    { configurationSnapshot: null },
    {
      configurationSnapshot: {
        ...validSnapshot(),
        webAccess: { ...validSnapshot().webAccess, state: 'degraded', error: '' },
      },
    },
  ])('rejects malformed configuration failure details %#', details => {
    expect(() => normalizeHomeWorkerConfigurationFailureDetails(details)).toThrow(OpenCoveAppError)
  })

  it('preserves a normalized degraded snapshot on a Worker mutation error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: false,
            error: {
              code: 'worker.unavailable',
              details: { configurationSnapshot: validSnapshot(), ignored: true },
            },
          }),
      })),
    )

    const error = await invokeLocalWorkerConfiguration(workerConnection(), {
      kind: 'command',
      id: 'worker.webAccess.setSettings',
      payload: null,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCoveAppError)
    expect(error).toMatchObject({
      code: 'worker.unavailable',
      details: { configurationSnapshot: validSnapshot() },
    })
  })

  it('fails closed when a Worker error crosses the boundary with malformed details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        status: 200,
        text: async () =>
          JSON.stringify({
            __opencoveControlEnvelope: true,
            ok: false,
            error: {
              code: 'worker.unavailable',
              details: { configurationSnapshot: { config: null, webAccess: null } },
            },
          }),
      })),
    )

    const error = await invokeLocalWorkerConfiguration(workerConnection(), {
      kind: 'command',
      id: 'worker.webAccess.setSettings',
      payload: null,
    }).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(OpenCoveAppError)
    expect(error).toMatchObject({
      code: 'worker.unavailable',
      details: undefined,
      debugMessage: 'Invalid Worker configuration failure details.',
    })
  })
})
