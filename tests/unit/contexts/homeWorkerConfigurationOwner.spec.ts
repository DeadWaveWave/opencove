import { describe, expect, it, vi } from 'vitest'
import { createHomeWorkerConfigurationOwner } from '../../../src/contexts/settings/application/homeWorkerConfigurationOwner'
import type { HomeWorkerConfigFile } from '../../../src/contexts/settings/domain/homeWorkerConfig'
import type { WorkerWebAccessRuntime } from '../../../src/contexts/settings/application/workerWebAccess/workerWebAccessTypes'

const config: HomeWorkerConfigFile = {
  version: 1,
  mode: 'local',
  remote: null,
  webUi: {
    enabled: true,
    port: 4318,
    exposeOnLan: false,
    passwordHash: null,
  },
  updatedAt: '2026-08-31T00:00:00.000Z',
}

function toDto(value: HomeWorkerConfigFile) {
  return {
    version: 1 as const,
    mode: value.mode,
    remote: value.remote,
    webUi: {
      enabled: value.webUi.enabled,
      port: value.webUi.port,
      exposeOnLan: value.webUi.exposeOnLan,
      passwordSet: value.webUi.passwordHash !== null,
    },
    updatedAt: value.updatedAt,
  }
}

describe('Home Worker configuration owner', () => {
  it('attaches the typed degraded snapshot when listener restoration rejects the mutation', async () => {
    const degraded = {
      state: 'degraded' as const,
      generation: 7,
      address: {
        hostname: '127.0.0.1',
        bindHostname: '127.0.0.1',
        port: 4318,
      },
      passwordRequired: false,
      error: 'Listener restoration pending.',
      drainingGenerations: [6],
    }
    const webAccess: WorkerWebAccessRuntime = {
      ready: Promise.resolve(degraded),
      status: vi.fn(() => degraded),
      apply: vi.fn().mockRejectedValue(new Error('rollback bind failed')),
      dispose: vi.fn(),
    }
    const owner = createHomeWorkerConfigurationOwner({
      webAccess,
      readConfig: vi.fn().mockResolvedValue(config),
      mutateConfig: vi.fn(),
      toDto,
      hashWebUiPassword: vi.fn(),
    })

    let caught: unknown
    try {
      await owner.setWebUiSettings({
        value: { enabled: true, port: 4319 },
        expectedUpdatedAt: config.updatedAt,
      })
    } catch (error) {
      caught = error
    }

    expect(caught).toMatchObject({
      code: 'worker.unavailable',
      details: {
        configurationSnapshot: {
          config: toDto(config),
          webAccess: {
            state: 'degraded',
            generation: 7,
            hostname: '127.0.0.1',
            bindHostname: '127.0.0.1',
            port: 4318,
            passwordRequired: false,
            error: 'Listener restoration pending.',
            drainingGenerations: [6],
          },
        },
      },
    })
  })
})
