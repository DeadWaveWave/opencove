#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const DEFAULT_MAX_OLD_SPACE_SIZE_MB = 4096
const MAX_OLD_SPACE_SIZE_PATTERN = /(?:^|\s)--max-old-space-size(?:=|\s+)\d+(?=\s|$)/

export function resolveBuildHeapLimitMb(
  rawValue = process.env.OPENCOVE_BUILD_MAX_OLD_SPACE_SIZE_MB,
) {
  const parsed = Number.parseInt(rawValue ?? '', 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OLD_SPACE_SIZE_MB
}

export function ensureMaxOldSpaceSizeOption(
  nodeOptions,
  maxOldSpaceSizeMb = DEFAULT_MAX_OLD_SPACE_SIZE_MB,
) {
  const normalized = typeof nodeOptions === 'string' ? nodeOptions.trim() : ''
  if (normalized.length === 0) {
    return `--max-old-space-size=${maxOldSpaceSizeMb}`
  }

  if (MAX_OLD_SPACE_SIZE_PATTERN.test(normalized)) {
    return normalized
  }

  return `${normalized} --max-old-space-size=${maxOldSpaceSizeMb}`
}

export function buildElectronViteEnv(baseEnv = process.env) {
  return {
    ...baseEnv,
    NODE_OPTIONS: ensureMaxOldSpaceSizeOption(
      baseEnv.NODE_OPTIONS,
      resolveBuildHeapLimitMb(baseEnv.OPENCOVE_BUILD_MAX_OLD_SPACE_SIZE_MB),
    ),
  }
}

async function main() {
  const env = buildElectronViteEnv()

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PNPM_COMMAND, ['exec', 'electron-vite', 'build'], {
      cwd: process.cwd(),
      env,
      shell: process.platform === 'win32',
      stdio: 'inherit',
      windowsHide: true,
    })

    child.on('error', rejectPromise)
    child.on('close', code => {
      resolvePromise(typeof code === 'number' ? code : 1)
    })
  })

  process.exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
