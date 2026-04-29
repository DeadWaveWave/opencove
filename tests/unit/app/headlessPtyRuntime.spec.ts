import { afterEach, describe, expect, it } from 'vitest'
import { createHeadlessPtyRuntime } from '../../../src/app/worker/headlessPtyRuntime'

const originalPlatform = process.platform

afterEach(() => {
  Object.defineProperty(process, 'platform', {
    value: originalPlatform,
    configurable: true,
  })
})

describe('createHeadlessPtyRuntime', () => {
  it('exposes Windows terminal profiles for worker-host clients', async () => {
    Object.defineProperty(process, 'platform', {
      value: 'win32',
      configurable: true,
    })

    const runtime = createHeadlessPtyRuntime({ userDataPath: '/tmp/opencove-headless-test' })

    try {
      await expect(runtime.listProfiles()).resolves.toEqual({
        profiles: [{ id: 'powershell', label: 'PowerShell', runtimeKind: 'windows' }],
        defaultProfileId: 'powershell',
      })
    } finally {
      runtime.dispose()
    }
  })
})
