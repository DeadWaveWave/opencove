import { describe, expect, it } from 'vitest'
import { buildReleaseInstallerAssets } from '../../../scripts/lib/release-installer-assets.mjs'

const shellInstallSource = `#!/bin/sh
RELEASE_BASE_URL="\${OPENCOVE_RELEASE_BASE_URL:-https://github.com/\${OWNER}/\${REPO}/releases/latest/download}"
case "\${1:-}" in
  --help|-h)
    printf "Usage: opencove-install.sh [--uninstall]\\n"
    ;;
esac
`

const shellUninstallSource = '#!/bin/sh\n'

const powershellInstallSource = `param(
  [switch]$Uninstall,
  [switch]$Help
)

if ($Help) {
  Write-Output 'Usage: opencove-install.ps1 [-Uninstall]'
}

$ReleaseBaseUrl = if ($env:OPENCOVE_RELEASE_BASE_URL) {
  $env:OPENCOVE_RELEASE_BASE_URL
} else {
  "https://github.com/$Owner/$Repo/releases/latest/download"
}
`

const powershellUninstallSource = "$ErrorActionPreference = 'Stop'\n"

describe('release installer assets', () => {
  it('generates tag-pinned installer assets for nightly releases only', () => {
    const assets = buildReleaseInstallerAssets({
      tag: 'v0.2.0-nightly.20260501.1',
      shellInstallSource,
      shellUninstallSource,
      powershellInstallSource,
      powershellUninstallSource,
    })

    expect(assets.map(asset => asset.fileName)).toEqual([
      'opencove-install-v0.2.0-nightly.20260501.1.sh',
      'opencove-install-v0.2.0-nightly.20260501.1.ps1',
      'opencove-uninstall-v0.2.0-nightly.20260501.1.sh',
      'opencove-uninstall-v0.2.0-nightly.20260501.1.ps1',
    ])

    expect(assets[0]?.content).toContain(
      'RELEASE_BASE_URL="${OPENCOVE_RELEASE_BASE_URL:-https://github.com/DeadWaveWave/opencove/releases/download/v0.2.0-nightly.20260501.1}"',
    )
    expect(assets[0]?.content).toContain(
      'Usage: opencove-install-v0.2.0-nightly.20260501.1.sh [--uninstall]',
    )
    expect(assets[1]?.content).toContain(
      "Write-Output 'Usage: opencove-install-v0.2.0-nightly.20260501.1.ps1 [-Uninstall]'",
    )
    expect(assets[1]?.content).toContain(
      "'https://github.com/DeadWaveWave/opencove/releases/download/v0.2.0-nightly.20260501.1'",
    )
  })

  it('adds latest-stable aliases alongside tag-pinned assets for stable releases', () => {
    const assets = buildReleaseInstallerAssets({
      tag: 'v0.2.1',
      shellInstallSource,
      shellUninstallSource,
      powershellInstallSource,
      powershellUninstallSource,
    })

    expect(assets.map(asset => asset.fileName)).toEqual([
      'opencove-install-v0.2.1.sh',
      'opencove-install-v0.2.1.ps1',
      'opencove-uninstall-v0.2.1.sh',
      'opencove-uninstall-v0.2.1.ps1',
      'opencove-install.sh',
      'opencove-install.ps1',
      'opencove-uninstall.sh',
      'opencove-uninstall.ps1',
    ])

    expect(assets[4]?.content).toContain(
      'RELEASE_BASE_URL="${OPENCOVE_RELEASE_BASE_URL:-https://github.com/DeadWaveWave/opencove/releases/latest/download}"',
    )
    expect(assets[5]?.content).toContain(
      "'https://github.com/DeadWaveWave/opencove/releases/latest/download'",
    )
  })
})
