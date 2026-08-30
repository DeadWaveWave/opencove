import type { SpawnTerminalInput, SpawnTerminalResult } from '../../../../shared/contracts/dto'
import { createAppError } from '../../../../shared/errors/appError'
import type { SpawnPtyOptions } from '../../../../platform/process/pty/types'
import type { ControlSurfaceRemoteEndpointResolver } from './controlSurfaceHttpClient'
import {
  invokeRemoteControlSurfaceValue,
  parseSpawnTerminalResult,
} from './remotePtyRuntime.support'

export async function spawnRemoteTerminal(options: {
  endpointResolver: ControlSurfaceRemoteEndpointResolver
  input: SpawnTerminalInput
  onSpawned: (sessionId: string) => Promise<void>
}): Promise<SpawnTerminalResult> {
  const value = await invokeRemoteControlSurfaceValue<unknown>({
    endpointResolver: options.endpointResolver,
    kind: 'command',
    id: 'pty.spawn',
    payload: options.input,
    errorMessage: 'Failed to spawn remote terminal session',
  })
  const result = parseSpawnTerminalResult(value)
  await options.onSpawned(result.sessionId)
  return result
}

export async function spawnRemotePtySession(options: {
  spawnOptions: SpawnPtyOptions
  spawnTerminal: (input: SpawnTerminalInput) => Promise<SpawnTerminalResult>
}): Promise<{ sessionId: string }> {
  if (
    options.spawnOptions.command ||
    options.spawnOptions.env ||
    options.spawnOptions.args?.length
  ) {
    throw createAppError('common.unavailable', {
      debugMessage: 'Remote PTY runtime does not support custom spawnSession options yet.',
    })
  }
  const spawned = await options.spawnTerminal({
    cwd: options.spawnOptions.cwd,
    cols: options.spawnOptions.cols,
    rows: options.spawnOptions.rows,
    ...(options.spawnOptions.shell ? { shell: options.spawnOptions.shell } : {}),
  })
  return { sessionId: spawned.sessionId }
}
