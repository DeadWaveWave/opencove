import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const DEFAULT_OWNER = 'DeadWaveWave'
const DEFAULT_REPO = 'opencove'
const SHELL_INSTALL_USAGE_LINE = '    printf "Usage: opencove-install.sh [--uninstall]\\n"'
const SHELL_INSTALL_BASE_URL_LINE =
  'RELEASE_BASE_URL="${OPENCOVE_RELEASE_BASE_URL:-https://github.com/${OWNER}/${REPO}/releases/latest/download}"'
const POWERSHELL_INSTALL_USAGE_LINE = "  Write-Output 'Usage: opencove-install.ps1 [-Uninstall]'"
const POWERSHELL_INSTALL_BASE_URL_BLOCK = `$ReleaseBaseUrl = if ($env:OPENCOVE_RELEASE_BASE_URL) {
  $env:OPENCOVE_RELEASE_BASE_URL
} else {
  "https://github.com/$Owner/$Repo/releases/latest/download"
}`
const INSTALLER_ASSET_PREFIXES = ['opencove-install', 'opencove-uninstall']

function replaceOnce(source, searchValue, replaceValue, description) {
  if (!source.includes(searchValue)) {
    throw new Error(`Unable to rewrite ${description}.`)
  }

  return source.replace(searchValue, replaceValue)
}

function escapeDoubleQuotedShell(value) {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
}

function buildReleaseBaseUrl({ owner = DEFAULT_OWNER, repo = DEFAULT_REPO, tag, mode }) {
  if (mode === 'latest-stable') {
    return `https://github.com/${owner}/${repo}/releases/latest/download`
  }

  return `https://github.com/${owner}/${repo}/releases/download/${tag}`
}

function buildVersionedAssetName(baseName, tag) {
  const suffix = baseName.endsWith('.ps1') ? '.ps1' : '.sh'
  const prefix = baseName.slice(0, -suffix.length)
  return `${prefix}-${tag}${suffix}`
}

function isNightlyTag(tag) {
  return tag.includes('-nightly.')
}

function renderShellInstallScript({ source, scriptName, releaseBaseUrl }) {
  const withUsage = replaceOnce(
    source,
    SHELL_INSTALL_USAGE_LINE,
    `    printf "Usage: ${scriptName} [--uninstall]\\n"`,
    'shell install usage line',
  )

  return replaceOnce(
    withUsage,
    SHELL_INSTALL_BASE_URL_LINE,
    `RELEASE_BASE_URL="\${OPENCOVE_RELEASE_BASE_URL:-${escapeDoubleQuotedShell(releaseBaseUrl)}}"`,
    'shell install default release base url',
  )
}

function renderPowerShellInstallScript({ source, scriptName, releaseBaseUrl }) {
  const withUsage = replaceOnce(
    source,
    POWERSHELL_INSTALL_USAGE_LINE,
    `  Write-Output 'Usage: ${scriptName} [-Uninstall]'`,
    'PowerShell install usage line',
  )

  return replaceOnce(
    withUsage,
    POWERSHELL_INSTALL_BASE_URL_BLOCK,
    `$ReleaseBaseUrl = if ($env:OPENCOVE_RELEASE_BASE_URL) {
  $env:OPENCOVE_RELEASE_BASE_URL
} else {
  '${releaseBaseUrl}'
}`,
    'PowerShell install default release base url',
  )
}

export function buildReleaseInstallerAssets({
  tag,
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  shellInstallSource,
  shellUninstallSource,
  powershellInstallSource,
  powershellUninstallSource,
}) {
  if (typeof tag !== 'string' || tag.trim().length === 0) {
    throw new Error('Release tag is required to build installer assets.')
  }

  const trimmedTag = tag.trim()
  const assets = []

  const versionedShellInstallName = buildVersionedAssetName('opencove-install.sh', trimmedTag)
  const versionedPowerShellInstallName = buildVersionedAssetName('opencove-install.ps1', trimmedTag)
  const versionedShellUninstallName = buildVersionedAssetName('opencove-uninstall.sh', trimmedTag)
  const versionedPowerShellUninstallName = buildVersionedAssetName(
    'opencove-uninstall.ps1',
    trimmedTag,
  )
  const versionedBaseUrl = buildReleaseBaseUrl({
    owner,
    repo,
    tag: trimmedTag,
    mode: 'tag',
  })

  assets.push(
    {
      fileName: versionedShellInstallName,
      content: renderShellInstallScript({
        source: shellInstallSource,
        scriptName: versionedShellInstallName,
        releaseBaseUrl: versionedBaseUrl,
      }),
    },
    {
      fileName: versionedPowerShellInstallName,
      content: renderPowerShellInstallScript({
        source: powershellInstallSource,
        scriptName: versionedPowerShellInstallName,
        releaseBaseUrl: versionedBaseUrl,
      }),
    },
    {
      fileName: versionedShellUninstallName,
      content: shellUninstallSource,
    },
    {
      fileName: versionedPowerShellUninstallName,
      content: powershellUninstallSource,
    },
  )

  if (!isNightlyTag(trimmedTag)) {
    const latestBaseUrl = buildReleaseBaseUrl({
      owner,
      repo,
      tag: trimmedTag,
      mode: 'latest-stable',
    })

    assets.push(
      {
        fileName: 'opencove-install.sh',
        content: renderShellInstallScript({
          source: shellInstallSource,
          scriptName: 'opencove-install.sh',
          releaseBaseUrl: latestBaseUrl,
        }),
      },
      {
        fileName: 'opencove-install.ps1',
        content: renderPowerShellInstallScript({
          source: powershellInstallSource,
          scriptName: 'opencove-install.ps1',
          releaseBaseUrl: latestBaseUrl,
        }),
      },
      {
        fileName: 'opencove-uninstall.sh',
        content: shellUninstallSource,
      },
      {
        fileName: 'opencove-uninstall.ps1',
        content: powershellUninstallSource,
      },
    )
  }

  return assets
}

export async function writeReleaseInstallerAssets({
  tag,
  outputDir,
  owner = DEFAULT_OWNER,
  repo = DEFAULT_REPO,
  shellInstallSourcePath,
  shellUninstallSourcePath,
  powershellInstallSourcePath,
  powershellUninstallSourcePath,
}) {
  await mkdir(outputDir, { recursive: true })

  const existingEntries = await readdir(outputDir)
  await Promise.all(
    existingEntries
      .filter(entry => INSTALLER_ASSET_PREFIXES.some(prefix => entry.startsWith(prefix)))
      .map(async entry => {
        await rm(resolve(outputDir, entry), { force: true })
      }),
  )

  const [
    shellInstallSource,
    shellUninstallSource,
    powershellInstallSource,
    powershellUninstallSource,
  ] = await Promise.all([
    readFile(shellInstallSourcePath, 'utf8'),
    readFile(shellUninstallSourcePath, 'utf8'),
    readFile(powershellInstallSourcePath, 'utf8'),
    readFile(powershellUninstallSourcePath, 'utf8'),
  ])

  const assets = buildReleaseInstallerAssets({
    tag,
    owner,
    repo,
    shellInstallSource,
    shellUninstallSource,
    powershellInstallSource,
    powershellUninstallSource,
  })

  await Promise.all(
    assets.map(async asset => {
      await writeFile(resolve(outputDir, asset.fileName), asset.content)
    }),
  )

  return assets
}
