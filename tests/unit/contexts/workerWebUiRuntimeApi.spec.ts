import { describe, expect, it } from 'vitest'
import { readWorkerConfigurationSnapshotFromError } from '../../../src/contexts/settings/presentation/renderer/settingsPanel/workerWebUiRuntimeApi'

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
      state: 'degraded',
      generation: 3,
      hostname: '127.0.0.1',
      bindHostname: '127.0.0.1',
      port: 16661,
      passwordRequired: false,
      error: 'listener restoration pending',
      drainingGenerations: [2],
    },
  }
}

describe('Worker Web UI runtime error boundary', () => {
  it('returns a strictly normalized degraded snapshot from typed failure details', () => {
    expect(
      readWorkerConfigurationSnapshotFromError({
        details: { configurationSnapshot: validSnapshot(), ignored: 'transport-only' },
      }),
    ).toEqual(validSnapshot())
  })

  it.each([
    null,
    {},
    { details: null },
    { details: { configurationSnapshot: null } },
    {
      details: {
        configurationSnapshot: {
          ...validSnapshot(),
          webAccess: { ...validSnapshot().webAccess, port: 0 },
        },
      },
    },
  ])('fails closed for malformed failure details %#', error => {
    expect(readWorkerConfigurationSnapshotFromError(error)).toBeNull()
  })
})
