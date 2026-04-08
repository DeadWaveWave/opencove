import { app, ipcMain } from 'electron'
import { IPC_CHANNELS } from '../../../shared/contracts/ipc'
import type { ControlSurfaceInvokeRequest } from '../../../shared/contracts/controlSurface'
import type { ControlSurfaceRemoteEndpointResolver } from '../controlSurface/remote/controlSurfaceHttpClient'
import { createAppError, OpenCoveAppError } from '../../../shared/errors/appError'
import { invokeControlSurface } from '../controlSurface/remote/controlSurfaceHttpClient'
import { resolveControlSurfaceConnectionInfoFromUserData } from '../controlSurface/remote/resolveControlSurfaceConnectionInfo'
import { registerHandledIpc } from './handle'
import type { IpcRegistrationDisposable } from './types'

export type RegisterControlSurfaceIpcHandlersOptions = {
  endpointResolver?: ControlSurfaceRemoteEndpointResolver | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeInvokeRequestPayload(payload: unknown): ControlSurfaceInvokeRequest {
  if (!isRecord(payload)) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for control-surface:invoke.',
    })
  }

  const kind = payload.kind
  if (kind !== 'query' && kind !== 'command') {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for control-surface:invoke kind.',
    })
  }

  const idRaw = payload.id
  if (typeof idRaw !== 'string' || idRaw.trim().length === 0) {
    throw createAppError('common.invalid_input', {
      debugMessage: 'Invalid payload for control-surface:invoke id.',
    })
  }

  return {
    kind,
    id: idRaw.trim(),
    payload: payload.payload,
  }
}

export function registerControlSurfaceIpcHandlers(
  options: RegisterControlSurfaceIpcHandlersOptions = {},
): IpcRegistrationDisposable {
  const endpointResolver = options.endpointResolver ?? null

  registerHandledIpc(
    IPC_CHANNELS.controlSurfaceInvoke,
    async (_event, payload: unknown): Promise<unknown> => {
      const request = normalizeInvokeRequestPayload(payload)

      const connection =
        (endpointResolver ? await endpointResolver() : null) ??
        (await resolveControlSurfaceConnectionInfoFromUserData({
          userDataPath: app.getPath('userData'),
        }))

      if (!connection) {
        throw createAppError('worker.unavailable', { debugMessage: 'Home worker is unavailable.' })
      }

      try {
        const { httpStatus, result } = await invokeControlSurface(
          {
            hostname: connection.hostname,
            port: connection.port,
            token: connection.token,
          },
          request,
        )

        if (httpStatus !== 200 || !result) {
          throw createAppError('worker.unavailable', {
            debugMessage: `Control surface invoke failed (HTTP ${httpStatus}).`,
          })
        }

        if (result.ok === false) {
          throw createAppError(result.error)
        }

        return result.value
      } catch (error) {
        if (error instanceof OpenCoveAppError) {
          throw error
        }

        throw createAppError('worker.unavailable', {
          debugMessage:
            error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown invoke error.',
        })
      }
    },
    { defaultErrorCode: 'common.unexpected' },
  )

  return {
    dispose: () => {
      ipcMain.removeHandler(IPC_CHANNELS.controlSurfaceInvoke)
    },
  }
}
