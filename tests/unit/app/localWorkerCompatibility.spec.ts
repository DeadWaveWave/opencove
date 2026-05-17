import { describe, expect, it, vi } from 'vitest'

const { readRuntimeAppVersionMock } = vi.hoisted(() => ({
  readRuntimeAppVersionMock: vi.fn(() => 'test-version'),
}))

vi.mock('../../../src/app/main/controlSurface/runtimeAppVersion', () => ({
  readRuntimeAppVersion: readRuntimeAppVersionMock,
}))

import { resolveLocalWorkerReusePolicy } from '../../../src/app/main/worker/localWorkerCompatibility'
import { resolveLocalWorkerReusePolicy as resolveSharedLocalWorkerReusePolicy } from '../../../src/shared/runtime/localWorkerReusePolicy'

describe('local worker compatibility', () => {
  it('treats legacy connections without startedBy as stale for Desktop launches', () => {
    expect(
      resolveLocalWorkerReusePolicy({
        appVersion: 'test-version',
      }),
    ).toEqual({ canReuse: false })
  })

  it('reuses CLI-started workers through protocol compatibility instead of Desktop version gates', () => {
    expect(
      resolveLocalWorkerReusePolicy({
        startedBy: 'cli',
        appVersion: null,
      }),
    ).toEqual({ canReuse: true, expectedAppVersion: null })
  })

  it('requires matching app versions for Desktop-started workers', () => {
    expect(
      resolveLocalWorkerReusePolicy({
        startedBy: 'desktop',
        appVersion: 'test-version',
      }),
    ).toEqual({ canReuse: true, expectedAppVersion: 'test-version' })

    expect(
      resolveLocalWorkerReusePolicy({
        startedBy: 'desktop',
        appVersion: 'old-version',
      }),
    ).toEqual({ canReuse: false })
  })

  it('keeps Worker entry reuse policy pure by accepting the Desktop version as data', () => {
    expect(
      resolveSharedLocalWorkerReusePolicy(
        {
          startedBy: 'desktop',
          appVersion: ' test-version ',
        },
        {
          launcherStartedBy: 'desktop',
          desktopAppVersion: 'test-version',
        },
      ),
    ).toEqual({ canReuse: true, expectedAppVersion: 'test-version' })

    expect(
      resolveSharedLocalWorkerReusePolicy(
        {
          startedBy: 'desktop',
          appVersion: 'test-version',
        },
        {
          launcherStartedBy: 'desktop',
          desktopAppVersion: null,
        },
      ),
    ).toEqual({ canReuse: false })
  })
})
