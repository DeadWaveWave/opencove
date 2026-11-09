// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createAppError, toAppErrorDescriptor } from '../../../src/shared/errors/appError'
import { publicTerminalSpawnError } from '../../../src/shared/errors/terminalSpawnError'
import { createSessionGrantPtyRuntime } from '../../../src/app/main/controlSurface/sessionGrantPtyRuntime'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'

it.each(['application-error', 'serialized-descriptor'] as const)(
  'retains %s from the wrapped runtime while cancelling its pending grant',
  async form => {
    let token = ''
    const spawn = vi.fn(
      async (
        input: Parameters<ControlSurfacePtyRuntime['spawnSession']>[0],
      ): Promise<{ sessionId: string }> => {
        token = input.env!.OPENCOVE_CONTROL_TOKEN!
        const descriptor = {
          code: 'common.unavailable' as const,
          details: { reason: 'native_wsl_worker_required', payload: input.env },
          params: { token },
          debugMessage: token,
        }
        throw form === 'application-error'
          ? createAppError(descriptor)
          : JSON.parse(JSON.stringify(descriptor))
      },
    )
    const access = createSessionGrantPtyRuntime({
      runtime: {
        spawnSession: spawn,
        onExit: () => () => {},
      } as unknown as ControlSurfacePtyRuntime,
      controlUrl: () => 'http://fixture',
      cliPath: '/fixture/cli',
      ensureAssets: async () => ({ cliShimDirectory: '/fixture/shims' }),
    })
    try {
      let error: unknown
      try {
        await canvasSpawnIdentity.run(
          { projectId: 'project', spaceId: 'space', nodeId: 'node' },
          () =>
            access.runtime.spawnSession({
              cwd: '/fixture',
              command: 'fixture-shell',
              args: [],
              cols: 80,
              rows: 24,
              env: { PATH: '/fixture/bin' },
            }),
        )
      } catch (caught) {
        error = caught
      }
      const descriptor = publicTerminalSpawnError(
        JSON.parse(JSON.stringify(toAppErrorDescriptor(error))),
        'terminal.spawn_failed',
      ).toDescriptor()
      expect(descriptor).toEqual({
        code: 'common.unavailable',
        details: { reason: 'native_wsl_worker_required' },
        debugMessage: 'To create this terminal, connect to a Worker running inside WSL.',
      })
      expect(token.length).toBeGreaterThan(0)
      expect(JSON.stringify(descriptor)).not.toContain(token)
      expect(access.grants.verify(token)).toBeNull()
      expect(spawn).toHaveBeenCalledOnce()
    } finally {
      access.dispose()
    }
  },
)
