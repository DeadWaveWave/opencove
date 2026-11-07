// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createSessionGrantPtyRuntime } from '../../../src/app/main/controlSurface/sessionGrantPtyRuntime'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'

const identity = { projectId: 'p', spaceId: 's', nodeId: 'n' }
const input = { cwd: '/tmp', command: '/bin/sh', args: [], cols: 80, rows: 24 }
function fixture(spawn: ControlSurfacePtyRuntime['spawnSession']) {
  const exits = new Set<(event: { sessionId: string; exitCode: number }) => void>()
  const kill = vi.fn()
  const access = createSessionGrantPtyRuntime({
    runtime: {
      spawnSession: spawn,
      kill,
      write: () => {},
      resize: vi.fn(),
      onData: () => () => {},
      onExit: listener => {
        exits.add(listener)
        return () => {
          exits.delete(listener)
        }
      },
    },
    ensureAssets: async () => ({ cliShimDirectory: '/cli-shims' }),
    cliPath: '/app/out/cli/opencove.mjs',
    controlUrl: () => 'http://localhost:1234',
  })
  return {
    ...access,
    kill,
    exit: (sessionId: string) => exits.forEach(listener => listener({ sessionId, exitCode: 0 })),
  }
}

it('pending grant is unusable, failed spawn leaks no credential, and shutdown fences late completion', async () => {
  let release!: () => void
  const barrier = new Promise<void>(resolve => {
    release = resolve
  })
  let token = ''
  const f = fixture(async options => {
    token = options.env!.OPENCOVE_CONTROL_TOKEN!
    await barrier
    return { sessionId: 'late' }
  })
  const pending = canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input))
  const rejection = expect(pending).rejects.toThrow('Canvas PTY spawn failed.')
  await vi.waitFor(() => expect(token.length).toBeGreaterThan(0))
  expect(f.grants.verify(token)).toBeNull()
  f.dispose()
  release()
  await rejection
  expect(f.grants.verify(token)).toBeNull()
  expect(f.kill).toHaveBeenCalledWith('late')
})

it('exit before spawn resolves never activates its grant', async () => {
  let token = ''
  const f = fixture(async options => {
    token = options.env!.OPENCOVE_CONTROL_TOKEN!
    f.exit('early')
    return { sessionId: 'early' }
  })
  try {
    await expect(
      canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input)),
    ).rejects.toThrow('Canvas PTY spawn failed.')
    expect(f.grants.verify(token)).toBeNull()
  } finally {
    f.dispose()
  }
})

it('concurrent spawn contexts stay isolated and exit/kill revoke synchronously', async () => {
  const captured: NodeJS.ProcessEnv[] = []
  const f = fixture(async options => {
    const env = options.env!
    captured.push(env)
    await Promise.resolve()
    return { sessionId: env.OPENCOVE_NODE_ID! }
  })
  try {
    await Promise.all(
      ['a', 'b'].map(nodeId =>
        canvasSpawnIdentity.run({ ...identity, nodeId }, () =>
          f.runtime.spawnSession({
            ...input,
            env: { OPENCOVE_CONTROL_TOKEN: 'spoof', OPENCOVE_NODE_ID: 'spoof' },
          }),
        ),
      ),
    )
    for (const env of captured) {
      expect(f.grants.verify(env.OPENCOVE_CONTROL_TOKEN!)).toMatchObject({
        nodeId: env.OPENCOVE_NODE_ID,
        sessionId: env.OPENCOVE_NODE_ID,
      })
      expect(env.OPENCOVE_CONTROL_TOKEN).not.toBe('spoof')
    }
    f.exit('a')
    f.runtime.kill('b')
    for (const env of captured) {
      expect(f.grants.verify(env.OPENCOVE_CONTROL_TOKEN!)).toBeNull()
    }
  } finally {
    f.dispose()
  }
})

it('sanitizes environment-bearing spawn failures without logging tokens', async () => {
  let token = ''
  const f = fixture(async options => {
    token = options.env!.OPENCOVE_CONTROL_TOKEN!
    throw new Error(JSON.stringify(options))
  })
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await expect(
      canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input)),
    ).rejects.toThrow(/^Canvas PTY spawn failed\.$/)
    expect(f.grants.verify(token)).toBeNull()
    expect(JSON.stringify(log.mock.calls)).not.toContain(token)
  } finally {
    log.mockRestore()
    f.dispose()
  }
})

it('treats a caller environment as complete and never re-adds the hosting process environment', async () => {
  const captured: NodeJS.ProcessEnv[] = []
  const f = fixture(async options => {
    captured.push(options.env!)
    return { sessionId: `s${captured.length}` }
  })
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  vi.stubEnv('OPENCOVE_TEST_HOST_ONLY', 'host')
  try {
    // The agent launcher strips Electron control mode from the environment it passes.
    await canvasSpawnIdentity.run(identity, () =>
      f.runtime.spawnSession({ ...input, env: { PATH: '/usr/bin', LANG: 'C' } }),
    )
    // Without an explicit environment the hosting environment is inherited, minus Electron control mode.
    await canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input))
    await f.runtime.spawnSession({ ...input, env: { PATH: '/usr/bin' } })

    const [explicit, inherited, plain] = captured
    expect(explicit.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(explicit.OPENCOVE_TEST_HOST_ONLY).toBeUndefined()
    expect(explicit.LANG).toBe('C')
    expect(explicit.PATH).toBe(
      ['/cli-shims', '/usr/bin'].join(process.platform === 'win32' ? ';' : ':'),
    )
    expect(explicit.OPENCOVE_NODE_ID).toBe('n')
    expect(inherited.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(inherited.OPENCOVE_TEST_HOST_ONLY).toBe('host')
    expect(plain.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(plain.OPENCOVE_TEST_HOST_ONLY).toBeUndefined()
  } finally {
    vi.unstubAllEnvs()
    f.dispose()
  }
})
