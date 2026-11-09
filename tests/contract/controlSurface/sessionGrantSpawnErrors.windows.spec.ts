// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createControlSurface } from '../../../src/app/main/controlSurface/controlSurface'
import { registerSessionStreamingHandlers } from '../../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { createSessionGrantPtyRuntime } from '../../../src/app/main/controlSurface/sessionGrantPtyRuntime'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { SessionGrantRegistry } from '../../../src/app/main/controlSurface/http/sessionGrantRegistry'
import { createControlSurfaceHttpServerContext } from '../../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import { invoke } from '../../../src/app/cli/core/transport'
import { CliError, printError } from '../../../src/app/cli/core/errors'
import type { CliIo } from '../../../src/app/cli/core/io'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createReadyTerminalAdmissionDeps } from '../../unit/contexts/controlSurfaceTestTerminalAvailability'
import { createInMemoryPersistenceStore } from './controlSurfaceHttpServer.sessionStreaming.testUtils'

vi.mock('../../../src/platform/terminal/TerminalProfileResolver', async importOriginal => {
  const actual =
    await importOriginal<typeof import('../../../src/platform/terminal/TerminalProfileResolver')>()
  return {
    ...actual,
    TerminalProfileResolver: class extends actual.TerminalProfileResolver {
      constructor() {
        super({
          platform: 'win32',
          env: () => ({}),
          homeDir: () => 'C:\\Users\\fixture',
          processCwd: () => 'C:\\project',
          locateWindowsCommands: async () => [],
          listWslDistros: async () => ['Ubuntu'],
        })
      }
    },
  }
})
const originalPlatform = process.platform
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', { value: originalPlatform, configurable: true })
  vi.clearAllMocks()
})

for (const caller of ['grant', 'bearer', 'cookie'] as const) {
  it.each(['tty', 'json'] as const)(
    `renders the real WSL refusal for ${caller} in %s output`,
    async format => {
      const spawn = vi.fn(async () => ({ sessionId: 'must-not-spawn' }))
      const assets = vi.fn(async () => ({ cliShimDirectory: '/fixture' }))
      const access = createSessionGrantPtyRuntime({
        runtime: {
          spawnSession: spawn,
          onExit: () => () => {},
          onData: () => () => {},
        } as unknown as ControlSurfacePtyRuntime,
        ensureAssets: assets,
        controlUrl: () => 'http://fixture',
        cliPath: '/fixture/cli',
      })
      const identity = { nodeId: 'node', spaceId: 'space', projectId: 'project' }
      const surface = createControlSurface({
        run: async (_ctx, _request, execute) => await canvasSpawnIdentity.run(identity, execute),
      })
      registerSessionStreamingHandlers(surface, {
        ...createReadyTerminalAdmissionDeps(),
        ptyRuntime: access.runtime,
        ptyStreamHub: { registerSessionMetadata: vi.fn() } as never,
        approvedWorkspaces: { isPathApproved: async () => true } as never,
        getPersistenceStore: async () => createInMemoryPersistenceStore(),
        topology: {} as never,
      })
      const { grant } = new SessionGrantRegistry(() => true).issue({
        ...identity,
        sessionId: 'caller-session',
      })
      const base = createControlSurfaceHttpServerContext({
        enableWebShell: false,
        ptyProtocolVersion: 1,
        replayWindowMaxBytes: 10,
      })
      const requestAuth =
        caller === 'grant'
          ? { kind: 'session-grant' as const, grant }
          : caller === 'bearer'
            ? { kind: 'bearer' as const }
            : { kind: 'cookie' as const, webSessionGeneration: 0 }
      let serverResult: unknown
      const fetch: typeof globalThis.fetch = async (_url, init) => {
        const result = await surface.invoke(
          { ...base, requestAuth },
          JSON.parse(String(init?.body)),
        )
        serverResult = result
        return new Response(JSON.stringify(result), { status: 200 })
      }
      try {
        let error: unknown
        try {
          await invoke(
            { endpoint: 'http://fixture', token: 'test-token' },
            {
              kind: 'command',
              id: 'pty.spawn',
              payload: {
                cwd: 'C:\\project',
                profileId: 'wsl:Ubuntu',
                cols: 80,
                rows: 24,
              },
            },
            { timeoutMs: 1000, fetch },
          )
        } catch (caught) {
          error = caught
        }
        expect(error).toBeInstanceOf(CliError)
        expect(serverResult).toMatchObject({
          ok: false,
          error: { code: 'common.unavailable', details: { reason: 'native_wsl_worker_required' } },
        })
        expect(error).toMatchObject({
          code: 'common.unavailable',
          exitCode: 1,
          message: 'To create this terminal, connect to a Worker running inside WSL.',
        })
        let stderr = ''
        printError(
          {
            stderr: {
              isTTY: format === 'tty',
              write: text => {
                stderr += text
              },
            },
          } as CliIo,
          error as CliError,
          format === 'json',
        )
        expect(stderr).toContain('To create this terminal, connect to a Worker running inside WSL.')
        if (format === 'json') {
          expect(JSON.parse(stderr)).toMatchObject({
            error: {
              code: 'common.unavailable',
              details: { reason: 'native_wsl_worker_required' },
            },
          })
        }
        expect(spawn).not.toHaveBeenCalled()
        expect(assets).not.toHaveBeenCalled()
      } finally {
        access.dispose()
      }
    },
  )
}
