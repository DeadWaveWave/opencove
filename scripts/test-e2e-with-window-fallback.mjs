#!/usr/bin/env node

import { spawn } from 'node:child_process'

const forwardedArgs = process.argv.slice(2)
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

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

function resolveWindowMode(rawValue) {
  const normalized = rawValue?.toLowerCase()
  if (
    normalized === 'hidden' ||
    normalized === 'offscreen' ||
    normalized === 'inactive' ||
    normalized === 'normal'
  ) {
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
    return 'normal'
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
  if (!isTruthyEnv(process.env['OPENCOVE_E2E_SKIP_BUILD'])) {
    const buildResult = await runCommand(['build'])
    if (buildResult.code !== 0) {
      process.exit(buildResult.code)
    }
  }

  const currentWindowMode = resolveWindowMode(process.env['OPENCOVE_E2E_WINDOW_MODE'])
  const fallbackWindowMode = resolveFallbackWindowMode(currentWindowMode)

  const firstRunArgs = ['exec', 'playwright', 'test', ...forwardedArgs]
  const firstRun = await runCommand(firstRunArgs, {
    ...process.env,
    OPENCOVE_E2E_WINDOW_MODE: currentWindowMode,
  })
  if (firstRun.code === 0) {
    process.exit(0)
  }

  if (isTruthyEnv(process.env['OPENCOVE_E2E_DISABLE_CRASH_FALLBACK'])) {
    process.exit(firstRun.code)
  }

  if (!hasCrashSignature(firstRun.output)) {
    process.exit(firstRun.code)
  }

  if (!fallbackWindowMode) {
    process.exit(firstRun.code)
  }

  writeStderr(
    `[e2e-fallback] Detected crash-like failure in ${currentWindowMode} mode. Rerunning last failed tests with OPENCOVE_E2E_WINDOW_MODE=${fallbackWindowMode}...`,
  )

  const fallbackRun = await runCommand(['exec', 'playwright', 'test', '--last-failed'], {
    ...process.env,
    OPENCOVE_E2E_WINDOW_MODE: fallbackWindowMode,
  })

  if (fallbackRun.code === 0) {
    writeStderr(
      `[e2e-fallback] Recovered by running failed tests in ${fallbackWindowMode} mode. Investigate ${currentWindowMode}-mode compatibility for long-term fix.`,
    )
    process.exit(0)
  }

  process.exit(fallbackRun.code)
}

void main().catch(error => {
  writeError(error)
  process.exit(1)
})
