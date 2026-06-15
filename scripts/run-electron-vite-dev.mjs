#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { constants as osConstants } from 'node:os'
import { posix as posixPath, win32 as win32Path } from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP']

export function buildElectronViteDevEnv(baseEnv = process.env) {
  const env = { ...baseEnv }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

export function resolveElectronViteCommand({
  cwd = process.cwd(),
  platform = process.platform,
} = {}) {
  const executableName = platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite'
  const pathApi = platform === 'win32' ? win32Path : posixPath
  return pathApi.join(cwd, 'node_modules', '.bin', executableName)
}

export function buildElectronViteDevSpawnConfig({
  args = [],
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
} = {}) {
  return {
    command: resolveElectronViteCommand({ cwd, platform }),
    args: ['dev', ...args],
    options: {
      cwd,
      detached: platform !== 'win32',
      env: buildElectronViteDevEnv(env),
      shell: platform === 'win32',
      stdio: ['ignore', 'inherit', 'inherit'],
      windowsHide: true,
    },
  }
}

export function resolveSignalExitCode(signal) {
  if (typeof signal !== 'string' || signal.length === 0) {
    return 1
  }

  const signalNumber = osConstants.signals?.[signal]
  return typeof signalNumber === 'number' ? 128 + signalNumber : 1
}

function sendSignalToChildGroup(child, signal, { platform, processKill }) {
  if (platform !== 'win32' && typeof child.pid === 'number' && child.pid > 0) {
    processKill(-child.pid, signal)
    return
  }

  child.kill(signal)
}

function resolveChildExitCode(code, signal) {
  if (typeof code === 'number') {
    return code
  }

  return resolveSignalExitCode(signal)
}

export async function runElectronViteDev({
  args = process.argv.slice(2),
  cwd = process.cwd(),
  env = process.env,
  platform = process.platform,
  processLike = process,
  processKill = process.kill,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  spawnImpl = spawn,
} = {}) {
  const exitCode = await new Promise((resolvePromise, rejectPromise) => {
    const childConfig = buildElectronViteDevSpawnConfig({ args, cwd, env, platform })
    const child = spawnImpl(childConfig.command, childConfig.args, childConfig.options)
    const signalHandlers = new Map()
    let isSettled = false
    let isShutdownStarted = false
    let forceKillTimer = null

    const clearForceKillTimer = () => {
      if (!forceKillTimer) {
        return
      }

      clearTimeout(forceKillTimer)
      forceKillTimer = null
    }

    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers.entries()) {
        processLike.off?.(signal, handler)
        processLike.removeListener?.(signal, handler)
      }
      signalHandlers.clear()
    }

    const settle = callback => {
      if (isSettled) {
        return
      }

      isSettled = true
      clearForceKillTimer()
      removeSignalHandlers()
      callback()
    }

    const forwardShutdownSignal = signal => {
      if (isSettled) {
        return
      }

      if (isShutdownStarted) {
        try {
          sendSignalToChildGroup(child, 'SIGKILL', { platform, processKill })
        } catch {
          // The child may already be gone.
        }
        return
      }

      isShutdownStarted = true

      try {
        sendSignalToChildGroup(child, signal, { platform, processKill })
      } catch {
        // The child may have already received the terminal signal or exited.
      }

      forceKillTimer = setTimeout(() => {
        try {
          sendSignalToChildGroup(child, 'SIGKILL', { platform, processKill })
        } catch {
          // The child may already be gone.
        }
      }, shutdownTimeoutMs)
      forceKillTimer.unref?.()
    }

    for (const signal of SHUTDOWN_SIGNALS) {
      const handler = () => forwardShutdownSignal(signal)
      signalHandlers.set(signal, handler)
      processLike.on(signal, handler)
    }

    child.on('error', error => {
      settle(() => rejectPromise(error))
    })
    child.on('close', (code, signal) => {
      settle(() => resolvePromise(resolveChildExitCode(code, signal)))
    })
  })

  return exitCode
}

async function main() {
  const exitCode = await runElectronViteDev()
  process.exit(exitCode)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch(error => {
    const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
    process.stderr.write(`${message}\n`)
    process.exit(1)
  })
}
