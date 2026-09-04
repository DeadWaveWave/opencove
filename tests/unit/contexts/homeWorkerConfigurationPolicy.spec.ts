import { describe, expect, it, vi } from 'vitest'
import {
  buildHomeWorkerModeConfig,
  buildHomeWorkerWebUiSecurityConfig,
  buildHomeWorkerWebUiSettingsConfig,
  normalizeHomeWorkerConfigInput,
} from '../../../src/contexts/settings/application/homeWorkerConfigurationPolicy'
import type { HomeWorkerConfigFile } from '../../../src/contexts/settings/domain/homeWorkerConfig'

function createLocalConfig(): HomeWorkerConfigFile {
  return {
    version: 1,
    mode: 'local',
    remote: null,
    webUi: {
      enabled: true,
      port: 4318,
      exposeOnLan: false,
      passwordHash: '$scrypt$existing',
    },
    updatedAt: '2026-08-31T00:00:00.000Z',
  }
}

describe('Home Worker configuration policy', () => {
  it('rejects remote mode without remote authority', () => {
    let caught: unknown
    try {
      normalizeHomeWorkerConfigInput({ mode: 'remote', remote: null })
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ code: 'common.invalid_input' })
  })

  it('preserves Web access authority while changing Worker mode', () => {
    const current = createLocalConfig()

    expect(
      buildHomeWorkerModeConfig(current, {
        mode: 'remote',
        remote: { hostname: 'worker.example.com', port: 16661, token: 'token' },
      }),
    ).toMatchObject({
      mode: 'remote',
      remote: { hostname: 'worker.example.com', port: 16661, token: 'token' },
      webUi: current.webUi,
    })
  })

  it('requires a password before exposing Web access on LAN', async () => {
    await expect(
      buildHomeWorkerWebUiSecurityConfig(
        {
          ...createLocalConfig(),
          webUi: { enabled: true, port: null, exposeOnLan: false, passwordHash: null },
        },
        { exposeOnLan: true, password: null },
        vi.fn(),
      ),
    ).rejects.toMatchObject({ code: 'common.invalid_input' })
  })

  it('hashes a new password through the injected infrastructure port', async () => {
    const hashPassword = vi.fn().mockResolvedValue('$scrypt$new')

    await expect(
      buildHomeWorkerWebUiSecurityConfig(
        createLocalConfig(),
        { exposeOnLan: true, password: 'secret' },
        hashPassword,
      ),
    ).resolves.toMatchObject({
      webUi: { enabled: true, port: 4318, exposeOnLan: true, passwordHash: '$scrypt$new' },
    })
    expect(hashPassword).toHaveBeenCalledWith('secret')
  })

  it('normalizes random-port settings without changing password ownership', () => {
    const current = createLocalConfig()

    expect(buildHomeWorkerWebUiSettingsConfig(current, { enabled: false, port: 0 })).toMatchObject({
      webUi: {
        enabled: false,
        port: null,
        exposeOnLan: false,
        passwordHash: '$scrypt$existing',
      },
    })
  })
})
