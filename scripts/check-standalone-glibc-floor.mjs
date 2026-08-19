#!/usr/bin/env node
/**
 * Asserts that the native artifacts in a standalone server bundle stay within the supported
 * versioned-symbol floor (see scripts/lib/standalone-glibc-floor.mjs).
 *
 * This reads the produced ELF files rather than trusting the build environment, so it holds no
 * matter which container or runner happened to compile them. It is the cheap, deterministic gate;
 * the container smoke test remains the proof that the server actually boots.
 *
 * Usage: node scripts/check-standalone-glibc-floor.mjs <app-root> <bundled-node>
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { relative, resolve } from 'node:path'

import {
  STANDALONE_GLIBC_FLOOR,
  formatFloorViolations,
  parseVersionedSymbolRequirements,
  resolveGlibcFloorArtifacts,
  resolveReadelfInvocation,
  selectFloorViolations,
} from './lib/standalone-glibc-floor.mjs'

const [appRoot, bundledNodeExecutable] = process.argv.slice(2)
if (!appRoot || !bundledNodeExecutable) {
  process.stderr.write(
    'Usage: node scripts/check-standalone-glibc-floor.mjs <app-root> <bundled-node>\n',
  )
  process.exit(1)
}

const artifacts = resolveGlibcFloorArtifacts({ appRoot, bundledNodeExecutable })

// Fail closed. A missing expected artifact means the bundle layout changed under us, and reporting
// "floor OK" for a bundle we did not actually inspect would be a false green.
const missing = artifacts.filter(artifact => !existsSync(artifact))
if (missing.length > 0) {
  process.stderr.write(
    `Expected native artifacts are missing, refusing to report success:\n${missing
      .map(artifact => `  ${artifact}`)
      .join('\n')}\n`,
  )
  process.exit(1)
}

const bundleRoot = resolve(appRoot, '..')
const failures = []

for (const artifact of artifacts) {
  const name = relative(bundleRoot, artifact)
  let readelfOutput
  try {
    const invocation = resolveReadelfInvocation(artifact)
    readelfOutput = execFileSync(invocation.command, invocation.args, invocation.options)
  } catch (error) {
    failures.push(`${name}: could not read ELF version info (${error.message})`)
    continue
  }

  try {
    const requirements = parseVersionedSymbolRequirements(readelfOutput, { requireSymbols: true })
    const violations = selectFloorViolations(requirements)
    if (violations.length > 0) {
      failures.push(formatFloorViolations(name, violations))
      continue
    }

    const highestGlibc = requirements
      .filter(entry => entry.library === 'GLIBC')
      .map(entry => entry.version)
      .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }))
      .pop()
    process.stdout.write(`ok  ${name} (max GLIBC_${highestGlibc ?? 'none'})\n`)
  } catch (error) {
    failures.push(`${name}: ${error.message}`)
  }
}

if (failures.length > 0) {
  process.stderr.write(`\n${failures.join('\n')}\n`)
  process.exit(1)
}

const floorSummary = Object.entries(STANDALONE_GLIBC_FLOOR)
  .map(([library, version]) => `${library}_${version}`)
  .join(' / ')

process.stdout.write(`\nAll ${artifacts.length} native artifacts are within ${floorSummary}.\n`)
