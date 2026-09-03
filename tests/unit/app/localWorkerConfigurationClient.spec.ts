import { describe, expect, it } from 'vitest'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'
import { normalizeHomeWorkerConfigurationSnapshot } from '../../../src/app/main/worker/localWorkerConfigurationClient'

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
})
