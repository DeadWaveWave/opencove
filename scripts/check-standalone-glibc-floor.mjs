#!/usr/bin/env node
/**
 * Asserts that every native artifact in a standalone server bundle stays within the supported
 * versioned-symbol floor (see scripts/lib/standalone-glibc-floor.mjs).
 *
 * This reads the produced ELF files rather than trusting the build environment, so it holds no
 * matter which container or runner happened to compile them. It is the cheap, deterministic gate;
 * the container smoke test remains the proof that the server actually boots.
 *
 * Usage: node scripts/check-standalone-glibc-floor.mjs <bundle-root>
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { relative, resolve } from 'node:path'

import {
  STANDALONE_GLIBC_FLOOR,
  formatFloorViolations,
  parseVersionedSymbolRequirements,
  selectFloorViolations,
} from './lib/standalone-glibc-floor.mjs'

const bundleRoot = process.argv[2]
if (!bundleRoot) {
  process.stderr.write('Usage: node scripts/check-standalone-glibc-floor.mjs <bundle-root>\n')
  process.exit(1)
}

if (!existsSync(bundleRoot)) {
  process.stderr.write(`Bundle root does not exist: ${bundleRoot}\n`)
  process.exit(1)
}

async function collectNativeArtifacts(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(entry => collectNativeArtifacts(resolve(directory, entry.name))),
  )

  const here = entries
    .filter(
      entry => entry.isFile() && (entry.name.endsWith('.node') || entry.name === 'spawn-helper'),
    )
    .map(entry => resolve(directory, entry.name))

  return [...here, ...nested.flat()]
}

const artifacts = await collectNativeArtifacts(bundleRoot)

// Fail closed. Finding nothing means the layout changed or the bundle is incomplete; reporting
// "floor OK" in that case would be a false green.
if (artifacts.length === 0) {
  process.stderr.write(
    `Found no .node artifacts under ${bundleRoot}. Refusing to report success.\n`,
  )
  process.exit(1)
}

const failures = []
for (const artifact of artifacts) {
  const name = relative(bundleRoot, artifact)
  let readelfOutput
  try {
    readelfOutput = execFileSync('readelf', ['--version-info', artifact], { encoding: 'utf8' })
  } catch (error) {
    failures.push(`${name}: could not read ELF version info (${error.message})`)
    continue
  }

  try {
    const requirements = parseVersionedSymbolRequirements(readelfOutput, { requireSymbols: true })
    const violations = selectFloorViolations(requirements)
    if (violations.length > 0) {
      failures.push(formatFloorViolations(name, violations))
    } else {
      const highest = requirements
        .filter(entry => entry.library === 'GLIBC')
        .map(entry => entry.version)
        .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
        .pop()
      process.stdout.write(`ok  ${name} (max GLIBC_${highest ?? 'none'})\n`)
    }
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(
  `\nAll ${artifacts.length} native artifacts are within GLIBC_${STANDALONE_GLIBC_FLOOR.GLIBC} / GLIBCXX_${STANDALONE_GLIBC_FLOOR.GLIBCXX}.\n`,
)
