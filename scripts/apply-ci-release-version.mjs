#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const rootDir = resolve(import.meta.dirname, '..')
const packageJsonPath = resolve(rootDir, 'package.json')
const rawTag = process.argv[2]

if (!rawTag) {
  process.stderr.write('Usage: node scripts/apply-ci-release-version.mjs <git-tag>\n')
  process.exit(1)
}

const match = /^v(.+)$/.exec(rawTag.trim())
if (!match) {
  process.stderr.write(`Invalid release tag: ${rawTag}\n`)
  process.exit(1)
}

const releaseVersion = match[1]
const isNightly = releaseVersion.includes('-nightly.')
const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8'))

if (typeof packageJson.version !== 'string') {
  process.stderr.write('package.json is missing a valid version field.\n')
  process.exit(1)
}

if (!isNightly) {
  if (packageJson.version !== releaseVersion) {
    process.stderr.write(
      `Stable tag ${rawTag} does not match package.json version ${packageJson.version}.\n`,
    )
    process.exit(1)
  }

  process.stdout.write(`Stable release version confirmed: ${releaseVersion}\n`)
  process.exit(0)
}

packageJson.version = releaseVersion
await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
process.stdout.write(`Applied nightly CI version ${releaseVersion} to package.json\n`)
