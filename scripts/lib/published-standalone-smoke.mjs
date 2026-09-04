import { createHash } from 'node:crypto'

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

export function resolvePublishedCommandInvocation({ platform, command, args, comspec }) {
  if (platform !== 'win32' || !command.toLowerCase().endsWith('.cmd')) {
    return { command, args, windowsVerbatimArguments: false }
  }
  const quote = value => {
    if (/[\r\n"%!^&|<>]/u.test(value)) {
      throw new Error(`Unsupported Windows command argument: ${value}`)
    }
    return `"${value}"`
  }
  return {
    command: comspec || 'cmd.exe',
    args: ['/d', '/s', '/c', `"${quote(command)} ${args.map(quote).join(' ')}"`],
    windowsVerbatimArguments: true,
  }
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
  const uninstallerName = `opencove-uninstall-${normalizedTag}.${extension}`
  const latestInstallerName = stable ? `opencove-install.${extension}` : null
  const latestUninstallerName = stable ? `opencove-uninstall.${extension}` : null
  const bundleName = windows
    ? `opencove-server-windows-${normalizedArch}.zip`
    : `opencove-server-${normalizedPlatform}-${normalizedArch}.tar.gz`
  const normalizedReleaseRoot = releaseRoot.replace(/\/+$/u, '')
  const tagBaseUrl = `${normalizedReleaseRoot}/download/${normalizedTag}`
  const latestBaseUrl = `${normalizedReleaseRoot}/latest/download`

  return {
    tag: normalizedTag,
    version,
    stable,
    platform: normalizedPlatform,
    arch: normalizedArch,
    installerName,
    uninstallerName,
    latestInstallerName,
    latestUninstallerName,
    bundleName,
    installerUrl: `${tagBaseUrl}/${installerName}`,
    uninstallerUrl: `${tagBaseUrl}/${uninstallerName}`,
    bundleUrl: `${tagBaseUrl}/${bundleName}`,
    stableAliasInstallerAssetUrl: latestInstallerName
      ? `${tagBaseUrl}/${latestInstallerName}`
      : null,
    stableAliasUninstallerAssetUrl: latestUninstallerName
      ? `${tagBaseUrl}/${latestUninstallerName}`
      : null,
    latestInstallerUrl: latestInstallerName ? `${latestBaseUrl}/${latestInstallerName}` : null,
    latestUninstallerUrl: latestUninstallerName
      ? `${latestBaseUrl}/${latestUninstallerName}`
      : null,
    latestBundleUrl: stable ? `${latestBaseUrl}/${bundleName}` : null,
    checksumsUrl: `${tagBaseUrl}/SHA256SUMS.txt`,
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

function readPublishedChecksum(checksums, assetName) {
  for (const line of checksums.split(/\r?\n/u)) {
    const match = /^([A-Fa-f0-9]{64})\s+\*?(.+)$/u.exec(line.trim())
    if (match?.[2] === assetName) {
      return match[1].toLowerCase()
    }
  }
  throw new Error(`Published checksum is missing or invalid for ${assetName}`)
}

export function assertPublishedAssetChecksum(content, checksums, assetName) {
  const expected = readPublishedChecksum(checksums, assetName)
  const actual = createHash('sha256').update(content).digest('hex')
  if (actual !== expected) {
    throw new Error(
      `Published SHA256 mismatch for ${assetName}: expected ${expected}, got ${actual}`,
    )
  }
}

export function assertPublishedChecksumInventory(checksums, target) {
  const names = readChecksumAssetNames(checksums)
  const required = [
    target.installerName,
    target.uninstallerName,
    target.bundleName,
    target.latestInstallerName,
    target.latestUninstallerName,
  ].filter(value => typeof value === 'string')
  const missing = required.filter(name => !names.has(name))
  if (missing.length > 0) {
    throw new Error(`Published checksum inventory is missing: ${missing.join(', ')}`)
  }
}
