#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { pathToFileURL } from 'node:url'

const PNPM_COMMAND = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'

export function buildElectronViteDevEnv(baseEnv = process.env) {
  const env = { ...baseEnv }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

async function main() {
  const env = buildElectronViteDevEnv()
  const args = process.argv.slice(2)

  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(PNPM_COMMAND, ['exec', 'electron-vite', 'dev', ...args], {
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
