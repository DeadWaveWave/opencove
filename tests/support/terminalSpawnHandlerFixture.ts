import { vi } from 'vitest'
import { TerminalProfileResolver } from '../../src/platform/terminal/TerminalProfileResolver'
import { registerSessionStreamingHandlers } from '../../src/app/main/controlSurface/handlers/sessionStreamingHandlers'
import { registerPtyMountHandlers } from '../../src/app/main/controlSurface/handlers/ptyMountHandlers'
import { toFileUri } from '../../src/contexts/filesystem/domain/fileUri'
import type { ControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import type { ControlSurfacePtyRuntime } from '../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import type { PersistenceStore } from '../../src/platform/persistence/sqlite/PersistenceStore'
import type { TerminalSpawnAdmission } from '../../src/contexts/terminal/application/TerminalRuntimeAvailability'
import type { PtyStreamHub } from '../../src/app/main/controlSurface/ptyStream/ptyStreamHub'

/** Real handlers and activity adapter; only OS profile resolution and physical PTY are ports. */
export function terminalSpawnHandlerFixture(input: {
  surface: ControlSurface
  getStore(): Promise<PersistenceStore>
  admission: TerminalSpawnAdmission
  mounted?: boolean
  remote?: boolean
  resolveEndpoint?(): Promise<void>
  prepareActivity(): Promise<void>
}) {
  const profile = vi
    .spyOn(TerminalProfileResolver.prototype, 'resolveTerminalSpawn')
    .mockImplementation(async options => ({
      cwd: options.cwd,
      command: 'fixture-shell',
      args: [],
      env: {},
      profileId: null,
      runtimeKind: 'posix' as const,
    }))
  const spawn = vi.fn<ControlSurfacePtyRuntime['spawnSession']>(async () => ({
    sessionId: 'extra-shell',
  }))
  const dispose = vi.fn(async () => {}),
    commit = vi.fn(),
    metadata = vi.fn()
  const activity = {
    prepare: vi.fn(async (options: { command: string; args: readonly string[] }) => {
      await input.prepareActivity()
      return { command: options.command, args: [...options.args], environment: {}, dispose, commit }
    }),
  }
  const mount = {
    mountId: 'pending-mount',
    projectId: 'workspace',
    endpointId: input.remote ? 'remote' : 'local',
    targetId: 'target',
    rootPath: '/repo',
    rootUri: toFileUri('/repo'),
  }
  const topology = {
    listMounts: async () => ({ mounts: input.mounted ? [mount] : [] }),
    resolveMountTarget: async () => mount,
    resolveRemoteEndpointConnection: async () => {
      await input.resolveEndpoint?.()
      return { hostname: 'localhost', port: 4310, token: 'fixture' }
    },
  }
  const runtime = {
    spawnSession: spawn,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    onData: () => () => {},
    onExit: () => () => {},
    registerRemoteSession: vi.fn(() => 'home-remote-shell'),
  }
  const hub = {
    isSessionActive: () => false,
    registerSessionMetadata: metadata,
    listSessions: () => ({ sessions: [] }),
  } as unknown as PtyStreamHub
  const deps = {
    getPersistenceStore: input.getStore,
    terminalSpawnAdmission: input.admission,
    approvedWorkspaces: { isPathApproved: async () => true },
    topology,
    ptyRuntime: runtime,
    ptyStreamHub: hub,
    terminalAgentActivity: activity,
  }
  registerSessionStreamingHandlers(input.surface, deps as never)
  registerPtyMountHandlers(input.surface, deps as never)
  return {
    spawn,
    dispose,
    commit,
    metadata,
    activity,
    mount,
    close: async () => {
      try {
        await Promise.all(spawn.mock.calls.map(([options]) => options.launchArtifacts?.dispose()))
      } finally {
        profile.mockRestore()
      }
    },
  }
}
