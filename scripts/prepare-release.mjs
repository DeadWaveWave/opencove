#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rootDir = resolve(import.meta.dirname, '..')
const packageJsonPath = resolve(rootDir, 'package.json')
const changelogPath = resolve(rootDir, 'CHANGELOG.md')

const [, , rawTarget, ...rawFlags] = process.argv
const dryRun = rawFlags.includes('--dry-run')

function parseVersion(value) {
  const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(value)
  if (!match) {
    return null
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  }
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`
}

function isMinorOrMajorRelease(currentVersion, nextVersion) {
  return (
    nextVersion.major > currentVersion.major ||
    (nextVersion.major === currentVersion.major && nextVersion.minor > currentVersion.minor)
  )
}

function bumpVersion(currentVersion, releaseType) {
  if (releaseType === 'patch') {
    return {
      major: currentVersion.major,
      minor: currentVersion.minor,
      patch: currentVersion.patch + 1,
    }
  }

  if (releaseType === 'minor') {
    return {
      major: currentVersion.major,
      minor: currentVersion.minor + 1,
      patch: 0,
    }
  }

  if (releaseType === 'major') {
    return {
      major: currentVersion.major + 1,
      minor: 0,
      patch: 0,
    }
  }

  return parseVersion(releaseType)
}

function buildReleaseSection(nextVersion, releaseDate, includeHighlights) {
  const section = [
    `## [${nextVersion}] - ${releaseDate}`,
    '',
    `Welcome to OpenCove ${nextVersion}! This release focuses on...`,
    '',
  ]

  if (includeHighlights) {
    section.push('### ✨ Highlights', '- **Feature Name**: Description', '')
  }

  section.push(
    '### 🚀 Added',
    '- TBD',
    '',
    '### 💅 Changed',
    '- TBD',
    '',
    '### 🐞 Fixed',
    '- TBD',
    '',
  )

  return section.join('\n')
}

function updateChangelog(changelog, nextVersion, releaseDate, includeHighlights) {
  const versionHeading = `## [${nextVersion}] - ${releaseDate}`
  if (changelog.includes(versionHeading)) {
    return changelog
  }

  const separator = '\n---\n\n'
  const insertAt = changelog.indexOf(separator)
  if (insertAt === -1) {
    throw new Error('CHANGELOG.md is missing the expected header separator.')
  }

  const before = changelog.slice(0, insertAt + separator.length)
  const after = changelog.slice(insertAt + separator.length)
  return `${before}${buildReleaseSection(nextVersion, releaseDate, includeHighlights)}${after}`
}

function printUsage() {
  process.stderr.write(
    'Usage: node scripts/prepare-release.mjs <patch|minor|major|x.y.z> [--dry-run]\n',
  )
}

if (!rawTarget) {
  printUsage()
  process.exitCode = 1
} else {
  const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))
  const currentVersion = parseVersion(packageJson.version)

  if (!currentVersion) {
    throw new Error(`Unsupported current version: ${packageJson.version}`)
  }

  const nextVersionParts = bumpVersion(currentVersion, rawTarget)
  if (!nextVersionParts) {
    printUsage()
    process.exitCode = 1
  } else {
    const nextVersion = formatVersion(nextVersionParts)
    const currentVersionString = formatVersion(currentVersion)

    if (nextVersion === currentVersionString) {
      throw new Error(`Target version ${nextVersion} matches the current version.`)
    }

    const releaseDate = new Date().toISOString().slice(0, 10)
    const includeHighlights = isMinorOrMajorRelease(currentVersion, nextVersionParts)
    const nextPackageJson = {
      ...packageJson,
      version: nextVersion,
    }
    const currentChangelog = await readFile(changelogPath, 'utf8')
    const nextChangelog = updateChangelog(
      currentChangelog,
      nextVersion,
      releaseDate,
      includeHighlights,
    )

    if (!dryRun) {
      await writeFile(packageJsonPath, `${JSON.stringify(nextPackageJson, null, 2)}\n`)
      await writeFile(changelogPath, nextChangelog)
    }

    const actionLabel = dryRun ? 'Dry run' : 'Prepared'
    process.stdout.write(
      [
        `${actionLabel} release ${currentVersionString} -> ${nextVersion}`,
        `- package.json version: ${nextVersion}`,
        `- changelog section: ## [${nextVersion}] - ${releaseDate}`,
        `- highlights template: ${includeHighlights ? 'included' : 'not required'}`,
        '',
        'Next steps:',
        "1. Fill in the changelog and curated user-facing What's New manifest.",
        '2. Run `pnpm pre-commit`, commit, and merge the release prep.',
        '3. Run the Release workflow dry-run against the exact accepted main SHA.',
        `4. Create an annotated tag with \`git tag -a v${nextVersion} -m "OpenCove v${nextVersion}"\`.`,
        `5. Push \`v${nextVersion}\`, then verify the published assets and standalone Worker smoke.`,
        '',
      ].join('\n'),
    )
  }
}
