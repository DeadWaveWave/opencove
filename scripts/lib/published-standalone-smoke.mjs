const DEFAULT_RELEASE_ROOT = 'https://github.com/DeadWaveWave/opencove/releases'
const RELEASE_TAG_PATTERN = /^v\d+\.\d+\.\d+(?:-nightly\.\d{8}\.\d+)?$/u

function normalizeReleasePlatform(platform) {
  if (platform === 'darwin') {
    return 'macos'
  }
  if (platform === 'linux') {
    return 'linux'
  }
  if (platform === 'win32') {
    return 'windows'
  }
  throw new Error(`Unsupported published standalone platform: ${platform}`)
}

function normalizeReleaseArch(arch) {
  if (arch === 'x64' || arch === 'arm64') {
    return arch
  }
  throw new Error(`Unsupported published standalone architecture: ${arch}`)
}

export function resolvePublishedStandaloneReleaseTarget({
  tag,
  platform,
  arch,
  releaseRoot = DEFAULT_RELEASE_ROOT,
}) {
  const normalizedTag = tag.trim()
  if (!RELEASE_TAG_PATTERN.test(normalizedTag)) {
    throw new Error(`Unsupported release tag: ${tag}`)
  }

  const normalizedPlatform = normalizeReleasePlatform(platform)
  const normalizedArch = normalizeReleaseArch(arch)
  const windows = normalizedPlatform === 'windows'
  const extension = windows ? 'ps1' : 'sh'
  const stable = !normalizedTag.includes('-nightly.')
  const version = normalizedTag.slice(1)
  const installerName = `opencove-install-${normalizedTag}.${extension}`
  const latestInstallerName = stable ? `opencove-install.${extension}` : null
  const bundleName = windows
    ? `opencove-server-windows-${normalizedArch}.zip`
    : `opencove-server-${normalizedPlatform}-${normalizedArch}.tar.gz`
  const normalizedReleaseRoot = releaseRoot.replace(/\/+$/u, '')

  return {
    tag: normalizedTag,
    version,
    stable,
    platform: normalizedPlatform,
    arch: normalizedArch,
    installerName,
    latestInstallerName,
    bundleName,
    installerUrl: `${normalizedReleaseRoot}/download/${normalizedTag}/${installerName}`,
    latestInstallerUrl: latestInstallerName
      ? `${normalizedReleaseRoot}/latest/download/${latestInstallerName}`
      : null,
    checksumsUrl: `${normalizedReleaseRoot}/download/${normalizedTag}/SHA256SUMS.txt`,
  }
}

function readChecksumAssetNames(checksums) {
  return new Set(
    checksums
      .split(/\r?\n/u)
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.split(/\s+/u).at(-1)?.replace(/^\*/u, '') ?? ''),
  )
}

export function assertPublishedChecksumInventory(checksums, target) {
  const names = readChecksumAssetNames(checksums)
  const required = [target.installerName, target.bundleName, target.latestInstallerName].filter(
    value => typeof value === 'string',
  )
  const missing = required.filter(name => !names.has(name))
  if (missing.length > 0) {
    throw new Error(`Published checksum inventory is missing: ${missing.join(', ')}`)
  }
}
