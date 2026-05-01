#!/usr/bin/env node

import { resolve } from 'node:path'
import { writeReleaseInstallerAssets } from './lib/release-installer-assets.mjs'

const rootDir = resolve(import.meta.dirname, '..')
const releaseTag = process.env['OPENCOVE_RELEASE_TAG']?.trim()
const owner = process.env['OPENCOVE_RELEASE_OWNER']?.trim() || 'DeadWaveWave'
const repo = process.env['OPENCOVE_RELEASE_REPO']?.trim() || 'opencove'
const outputDir = resolve(rootDir, process.argv[2] ?? 'release-assets')

if (!releaseTag) {
  process.stderr.write('OPENCOVE_RELEASE_TAG is required.\n')
  process.exit(1)
}

const assets = await writeReleaseInstallerAssets({
  tag: releaseTag,
  owner,
  repo,
  outputDir,
  shellInstallSourcePath: resolve(rootDir, 'scripts/release-assets/opencove-install.sh'),
  shellUninstallSourcePath: resolve(rootDir, 'scripts/release-assets/opencove-uninstall.sh'),
  powershellInstallSourcePath: resolve(rootDir, 'scripts/release-assets/opencove-install.ps1'),
  powershellUninstallSourcePath: resolve(rootDir, 'scripts/release-assets/opencove-uninstall.ps1'),
})

process.stdout.write(
  `Generated ${assets.length} release installer asset(s) for ${releaseTag} in ${outputDir}\n`,
)
