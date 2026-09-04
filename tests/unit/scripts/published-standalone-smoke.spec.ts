import { describe, expect, it } from 'vitest'
import {
  assertPublishedAssetChecksum,
  assertPublishedChecksumInventory,
  resolvePublishedStandaloneReleaseTarget,
} from '../../../scripts/lib/published-standalone-smoke.mjs'

describe('published standalone release smoke contract', () => {
  it('resolves the exact stable installer, uninstaller, and Linux Worker bundle for v0.3.0', () => {
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
      uninstallerName: 'opencove-uninstall-v0.3.0.sh',
      latestInstallerName: 'opencove-install.sh',
      latestUninstallerName: 'opencove-uninstall.sh',
      bundleName: 'opencove-server-linux-x64.tar.gz',
      installerUrl:
        'https://github.com/DeadWaveWave/opencove/releases/download/v0.3.0/opencove-install-v0.3.0.sh',
      uninstallerUrl:
        'https://github.com/DeadWaveWave/opencove/releases/download/v0.3.0/opencove-uninstall-v0.3.0.sh',
      bundleUrl:
        'https://github.com/DeadWaveWave/opencove/releases/download/v0.3.0/opencove-server-linux-x64.tar.gz',
      latestInstallerUrl:
        'https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh',
      latestUninstallerUrl:
        'https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-uninstall.sh',
      latestBundleUrl:
        'https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-server-linux-x64.tar.gz',
    })
  })

  it('keeps nightly Windows downloads tag-pinned without latest aliases', () => {
    expect(
      resolvePublishedStandaloneReleaseTarget({
        tag: 'v0.3.1-nightly.20260904.1',
        platform: 'win32',
        arch: 'x64',
      }),
    ).toMatchObject({
      stable: false,
      installerName: 'opencove-install-v0.3.1-nightly.20260904.1.ps1',
      uninstallerName: 'opencove-uninstall-v0.3.1-nightly.20260904.1.ps1',
      latestInstallerName: null,
      latestUninstallerName: null,
      bundleName: 'opencove-server-windows-x64.zip',
    })
  })

  it('requires checksums for installers, uninstallers, the platform bundle, and stable aliases', () => {
    const target = resolvePublishedStandaloneReleaseTarget({
      tag: 'v0.3.0',
      platform: 'darwin',
      arch: 'arm64',
    })
    const checksums = [
      `aaa  ${target.installerName}`,
      `bbb  ${target.uninstallerName}`,
      `ccc  ${target.bundleName}`,
      `ddd  ${target.latestInstallerName}`,
      `eee  ${target.latestUninstallerName}`,
    ].join('\n')

    expect(() => assertPublishedChecksumInventory(checksums, target)).not.toThrow()
    expect(() => assertPublishedChecksumInventory(`aaa  ${target.installerName}`, target)).toThrow(
      /opencove-uninstall-v0\.3\.0\.sh/u,
    )
  })

  it('compares downloaded bytes with the release checksum instead of trusting filenames', () => {
    const content = Buffer.from('published installer')
    const sha256 = '71e9a493e408da448a75fd544de41d29171d4f64cbc0acbe77c4657909a814c5'
    const checksums = `${sha256}  opencove-install-v0.3.0.sh\n`

    expect(() =>
      assertPublishedAssetChecksum(content, checksums, 'opencove-install-v0.3.0.sh'),
    ).not.toThrow()
    expect(() =>
      assertPublishedAssetChecksum(
        Buffer.from('tampered installer'),
        checksums,
        'opencove-install-v0.3.0.sh',
      ),
    ).toThrow(/SHA256 mismatch/u)
  })
})
