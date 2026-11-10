import { createAppError } from '../../../shared/errors/appError'
import {
  createTerminalSpawnApplicationError,
  publicTerminalSpawnApplicationError,
} from '../../../shared/errors/terminalSpawnError'
import { basename, delimiter } from 'node:path'
import { removeElectronRunAsNode } from '../../../platform/os/ElectronControlEnvironment'
import type { ControlSurfacePtyRuntime } from './handlers/sessionPtyRuntime'
import { SessionGrantRegistry } from './http/sessionGrantRegistry'
import { canvasSpawnIdentity } from './sessionSpawnIdentityContext'
import {
  SessionRegistrationOwner,
  SessionRegistrationRejectedError,
} from '../../../shared/runtime/sessionRegistrationOwner'

/** The only credential injection point; wraps the hosting runtime, never a remote proxy. */
export function createSessionGrantPtyRuntime(options: {
  runtime: ControlSurfacePtyRuntime
  controlUrl: () => string
  cliPath: string
  onSpawnIdentity?: (sessionId: string, nodeId: string) => void
  ensureAssets: () => Promise<{ cliShimDirectory: string }>
}) {
  const sessions = new Set<string>()
  const registrations = new SessionRegistrationOwner()
  const grants = new SessionGrantRegistry(id => sessions.has(id))
  let closed = false
  const unsubscribe = options.runtime.onExit(({ sessionId }) => {
    registrations.noteCompletion(sessionId)
    sessions.delete(sessionId)
    grants.revokeSession(sessionId)
  })
  const runtime: ControlSurfacePtyRuntime = {
    ...options.runtime,
    kill: sessionId => {
      registrations.noteCompletion(sessionId)
      sessions.delete(sessionId)
      grants.revokeSession(sessionId)
      options.runtime.kill(sessionId)
    },
    spawnSession: async input => {
      // A caller environment is complete: callers deliberately remove variables such as
      // Electron control mode. Only an absent one inherits the hosting process environment.
      const env = input.env ? { ...input.env } : removeElectronRunAsNode(process.env)
      // Inherited credentials and user overrides never become authority for a new session.
      for (const key of Object.keys(env)) {
        if (
          /^OPENCOVE_(CONTROL_|NODE_ID$|SPACE_ID$|PROJECT_ID$|SESSION_ID$|CLI$|CLI_SHIM_DIRECTORY$|ENV$)/i.test(
            key,
          )
        ) {
          delete env[key]
        }
      }
      const identity = canvasSpawnIdentity.getStore()
      if (!identity) {
        return await options.runtime.spawnSession({ ...input, env })
      }
      if (process.platform === 'win32' && /^wsl(?:\.exe)?$/i.test(basename(input.command))) {
        throw createTerminalSpawnApplicationError('native_wsl_worker_required')
      }
      const assets = await options.ensureAssets()
      if (closed) {
        throw new Error('Session grant owner is closed.')
      }
      const url = options.controlUrl()
      if (!url) {
        throw new Error('Private Control Surface is not listening.')
      }
      const reservation = grants.reserve(identity)
      const attempt = registrations.begin()
      let settled = false
      try {
        Object.assign(env, {
          OPENCOVE_ENV: '1',
          ...(identity.nodeId ? { OPENCOVE_NODE_ID: identity.nodeId } : {}),
          OPENCOVE_SPACE_ID: identity.spaceId,
          OPENCOVE_PROJECT_ID: identity.projectId,
          OPENCOVE_CONTROL_URL: url,
          OPENCOVE_CONTROL_TOKEN: reservation.token,
          OPENCOVE_CLI: options.cliPath,
          OPENCOVE_CLI_SHIM_DIRECTORY: assets.cliShimDirectory,
        })
        const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
        // Only the CLI shim directory: provider shims on PATH would wrap a managed agent launch
        // in the terminal launcher, which then resolves its own shim again (unbounded recursion).
        env[pathKey] = [assets.cliShimDirectory, env[pathKey] ?? ''].join(delimiter)
        const spawned = await options.runtime.spawnSession({ ...input, env })
        const disposition = attempt.complete(spawned.sessionId)
        settled = true
        if (disposition !== 'active' || closed) {
          options.runtime.kill(spawned.sessionId)
          throw new SessionRegistrationRejectedError(
            spawned.sessionId,
            disposition === 'completed' ? 'completed' : 'owner_disposed',
          )
        }
        sessions.add(spawned.sessionId)
        reservation.commit(spawned.sessionId)
        if (identity.nodeId) {
          options.onSpawnIdentity?.(spawned.sessionId, identity.nodeId)
        }
        return spawned
      } catch (error) {
        if (!settled) {
          attempt.cancel()
        }
        reservation.cancel()
        const application = publicTerminalSpawnApplicationError(error)
        if (application) {
          throw createAppError(application)
        }
        // Never propagate a spawn error that might serialize its environment.
        // eslint-disable-next-line preserve-caught-error -- Private process data must not survive as a cause.
        throw new Error('Canvas PTY spawn failed.')
      }
    },
  }
  return {
    runtime,
    grants,
    dispose: () => {
      closed = true
      registrations.dispose()
      sessions.clear()
      grants.clear()
      unsubscribe()
    },
  }
}
