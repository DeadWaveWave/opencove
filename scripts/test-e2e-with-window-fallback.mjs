#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

// Package managers may preserve the `--` separator in argv when forwarding script arguments.
// Playwright treats a bare `--` as a positional filter and reports "No tests found", so
// normalize it away before we pass args through.
const forwardedArgs = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'))
const pnpmCommand = 'pnpm'

/**
 * Heuristic signatures for Electron/Chromium process-level crashes seen in Playwright output.
 * These are intentionally broad enough to catch the known hidden-window crash mode.
 */
const CRASH_SIGNATURE_PATTERNS = [
  /target page, context or browser has been closed/i,
  /signal=SIGSEGV/i,
  /signal=SIGABRT/i,
  /process crashed/i,
  /page crashed/i,
]

function isTruthyEnv(rawValue) {
  if (!rawValue) {
    return false
  }

  return rawValue === '1' || rawValue.toLowerCase() === 'true'
}

function hasCrashSignature(output) {
  return CRASH_SIGNATURE_PATTERNS.some(pattern => pattern.test(output))
}

async function cleanupE2ETempDirs() {
  const configuredTmpDir = process.env['OPENCOVE_E2E_TMPDIR']?.trim()
  const runnerTempDir = process.env['RUNNER_TEMP']?.trim()
  const candidates = new Set(
    [configuredTmpDir, runnerTempDir, tmpdir()].filter(
      value => typeof value === 'string' && value.trim().length > 0,
    ),
  )

  await Promise.all(
    [...candidates].map(baseDir =>
      rm(path.join(baseDir, 'opencove-e2e'), { recursive: true, force: true }).catch(
        () => undefined,
      ),
    ),
  )
}

function resolveWindowMode(rawValue) {
  const normalized = rawValue?.trim().toLowerCase()
  if (normalized === 'normal') {
    throw new Error(
      '[e2e] OPENCOVE_E2E_WINDOW_MODE=normal is not allowed because it steals OS focus. Use offscreen/inactive/hidden instead.',
    )
  }

  if (normalized === 'hidden' || normalized === 'offscreen' || normalized === 'inactive') {
    return normalized
  }

  return 'offscreen'
}

function resolveFallbackWindowMode(windowMode) {
  if (windowMode === 'hidden') {
    return 'offscreen'
  }

  if (windowMode === 'offscreen') {
    return 'inactive'
  }

  if (windowMode === 'inactive') {
    return 'inactive'
  }

  return null
}

function writeStderr(message) {
  process.stderr.write(`${message}\n`)
}

function writeError(error) {
  const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
  writeStderr(message)
}

function runCommand(args, env = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(pnpmCommand, args, {
      cwd: process.cwd(),
      env,
      shell: process.platform === 'win32',
      stdio: ['inherit', 'pipe', 'pipe'],
      windowsHide: true,
    })

    let output = ''

    child.stdout.on('data', chunk => {
      const text = chunk.toString()
      output += text
      process.stdout.write(text)
    })

    child.stderr.on('data', chunk => {
      const text = chunk.toString()
      output += text
      process.stderr.write(text)
    })

    child.on('error', error => {
      reject(error)
    })

    child.on('close', code => {
      resolve({
        code: typeof code === 'number' ? code : 1,
        output,
      })
    })
  })
}

async function main() {
  const isCi = isTruthyEnv(process.env.CI)
  const currentWindowMode = resolveWindowMode(process.env['OPENCOVE_E2E_WINDOW_MODE'])
  const fallbackWindowMode = resolveFallbackWindowMode(currentWindowMode)

  try {
    if (!isTruthyEnv(process.env['OPENCOVE_E2E_SKIP_BUILD'])) {
      const buildResult = await runCommand(['build'])
      if (buildResult.code !== 0) {
        return buildResult.code
      }
    }

    const firstRunArgs = ['exec', 'playwright', 'test', ...forwardedArgs]
    const firstRun = await runCommand(firstRunArgs, {
      ...process.env,
      OPENCOVE_E2E_WINDOW_MODE: currentWindowMode,
    })
    if (firstRun.code === 0) {
      return 0
    }

    if (isTruthyEnv(process.env['OPENCOVE_E2E_DISABLE_CRASH_FALLBACK'])) {
      return firstRun.code
    }

    if (!hasCrashSignature(firstRun.output)) {
      return firstRun.code
    }

    if (!fallbackWindowMode) {
      return firstRun.code
    }

    const rerunDescription =
      fallbackWindowMode === currentWindowMode
        ? `Rerunning last failed tests once more in ${fallbackWindowMode} mode to recover a transient crash-like failure.`
        : `Rerunning last failed tests with OPENCOVE_E2E_WINDOW_MODE=${fallbackWindowMode}.`
    writeStderr(
      `[e2e-fallback] Detected crash-like failure in ${currentWindowMode} mode. ${rerunDescription}`,
    )

    const fallbackRun = await runCommand(['exec', 'playwright', 'test', '--last-failed'], {
      ...process.env,
      OPENCOVE_E2E_WINDOW_MODE: fallbackWindowMode,
    })

    if (fallbackRun.code === 0) {
      writeStderr(
        fallbackWindowMode === currentWindowMode
          ? `[e2e-fallback] Recovered by rerunning failed tests in ${fallbackWindowMode} mode after a transient crash-like failure.`
          : `[e2e-fallback] Recovered by running failed tests in ${fallbackWindowMode} mode. Investigate ${currentWindowMode}-mode compatibility for long-term fix.`,
      )
      return 0
    }

    return fallbackRun.code
  } finally {
    if (isCi) {
      await cleanupE2ETempDirs()
    }
  }
}

void main()
  .then(code => {
    process.exit(code)
  })
  .catch(error => {
    writeError(error)
    process.exit(1)
  })
