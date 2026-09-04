import { describe, expect, it } from 'vitest'
import {
  assertPublishedChecksumInventory,
  resolvePublishedStandaloneReleaseTarget,
} from '../../../scripts/lib/published-standalone-smoke.mjs'

describe('published standalone release smoke contract', () => {
  it('resolves the exact stable installer and Linux Worker bundle for v0.3.0', () => {
    expect(
      resolvePublishedStandaloneReleaseTarget({
        tag: 'v0.3.0',
        platform: 'linux',
        arch: 'x64',
      }),
    ).toMatchObject({
      version: '0.3.0',
      stable: true,
      installerName: 'opencove-install-v0.3.0.sh',
      latestInstallerName: 'opencove-install.sh',
      bundleName: 'opencove-server-linux-x64.tar.gz',
      installerUrl:
        'https://github.com/DeadWaveWave/opencove/releases/download/v0.3.0/opencove-install-v0.3.0.sh',
      latestInstallerUrl:
        'https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh',
    })
  })

  it('keeps nightly Windows downloads tag-pinned without a latest alias', () => {
    expect(
      resolvePublishedStandaloneReleaseTarget({
        tag: 'v0.3.1-nightly.20260904.1',
        platform: 'win32',
        arch: 'x64',
      }),
    ).toMatchObject({
      stable: false,
      installerName: 'opencove-install-v0.3.1-nightly.20260904.1.ps1',
      latestInstallerName: null,
      bundleName: 'opencove-server-windows-x64.zip',
    })
  })

  it('requires checksums for the installer, platform bundle, and stable alias', () => {
    const target = resolvePublishedStandaloneReleaseTarget({
      tag: 'v0.3.0',
      platform: 'darwin',
      arch: 'arm64',
    })
    const checksums = [
      `aaa  ${target.installerName}`,
      `bbb  ${target.bundleName}`,
      `ccc  ${target.latestInstallerName}`,
    ].join('\n')

    expect(() => assertPublishedChecksumInventory(checksums, target)).not.toThrow()
    expect(() => assertPublishedChecksumInventory(`aaa  ${target.installerName}`, target)).toThrow(
      /opencove-server-macos-arm64\.tar\.gz/u,
    )
  })
})
