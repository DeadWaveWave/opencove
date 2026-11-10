// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { delimiter } from 'node:path'
import type { IncomingMessage } from 'node:http'
import { run } from '../../src/app/cli/core/run'
import { createSessionGrantPtyRuntime } from '../../src/app/main/controlSurface/sessionGrantPtyRuntime'
import {
  canvasSpawnIdentity,
  localCanvasResidentContext,
} from '../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { resolveCanvasSpawnIdentity } from '../../src/app/main/controlSurface/resolveCanvasSpawnIdentity'
import { createControlSurface } from '../../src/app/main/controlSurface/controlSurface'
import { registerSystemHandlers } from '../../src/app/main/controlSurface/handlers/systemHandlers'
import { registerSpaceHandlers } from '../../src/app/main/controlSurface/handlers/spaceHandlers'
import { resolveRequestAuth } from '../../src/app/main/controlSurface/http/requestAuth'
import { WebSessionManager } from '../../src/app/main/controlSurface/http/webSessionManager'
import type { ControlSurfacePtyRuntime } from '../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { identityFixture } from '../unit/app/cliIdentity.helpers'
import { createControlSurfaceHttpServerContext } from '../../src/app/main/controlSurface/controlSurfaceHttpServerContext'
import {
  createInMemoryPersistenceStore,
  createMinimalState,
} from '../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

async function fixture() {
  const store = createInMemoryPersistenceStore()
  await store.writeAppState(createMinimalState('/repo', 'p', 's'))
  const ctx = createControlSurfaceHttpServerContext({
    enableWebShell: false,
    ptyProtocolVersion: 1,
    replayWindowMaxBytes: 10,
  })
  let env: NodeJS.ProcessEnv = {}
  let exited: (event: { sessionId: string; exitCode: number }) => void = () => {}
  const onSpawnIdentity = vi.fn()
  const access = createSessionGrantPtyRuntime({
    runtime: {
      spawnSession: async input => {
        env = input.env!
        return { sessionId: 'standalone' }
      },
      onExit: listener => {
        exited = listener
        return () => {}
      },
      onData: () => () => {},
      kill: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
    } as ControlSurfacePtyRuntime,
    controlUrl: () => 'http://session-worker',
    cliPath: '/app/opencove.mjs',
    ensureAssets: async () => ({ cliShimDirectory: '/shims' }),
    onSpawnIdentity,
  })
  const identity = await resolveCanvasSpawnIdentity(ctx, { spaceId: 's' }, async () => store)
  const spawn = () =>
    access.runtime.spawnSession({
      command: 'fixture-agent',
      args: [],
      cwd: '/repo',
      cols: 80,
      rows: 24,
      env: {
        PATH: '/bin',
        OPENCOVE_NODE_ID: 'inherited-fake',
        OPENCOVE_CONTROL_TOKEN: 'parent-token',
      },
    })
  if (identity) {
    await canvasSpawnIdentity.run(identity, spawn)
  } else {
    await spawn()
  }
  const surface = createControlSurface()
  registerSystemHandlers(surface, { appVersion: 'test' })
  registerSpaceHandlers(surface, async () => store)
  const target = {
    id: 'target',
    projectId: 'p',
    spaceId: 's',
    kind: 'note',
    title: 'Brief',
    frame: { x: 0, y: 0, width: 280, height: 180 },
    data: { kind: 'note', text: 'Brief' },
  }
  for (const [id, kind, value] of [
    [
      'project.list',
      'query',
      { projects: [{ id: 'p', name: 'Project', path: '/repo', activeSpaceId: 's' }] },
    ],
    ['node.list', 'query', { projectId: 'p', spaceId: 's', nodes: [target] }],
    ['node.create', 'command', { node: { ...target, id: 'created' } }],
    ['filesystem.readFileText', 'query', { content: 'File contents' }],
    ['session.stopNode', 'command', { stopped: true }],
  ] as const) {
    surface.register(id, {
      kind,
      validate: payload => payload,
      handle: () => value,
      defaultErrorCode: 'common.unexpected',
    })
  }
  const f = identityFixture(false)
  f.io.env = env
  const profileReads = vi.fn(async () =>
    JSON.stringify({
      version: 1,
      hostname: 'localhost',
      port: 1234,
      pid: process.pid,
      token: 'admin-token',
      createdAt: new Date().toISOString(),
    }),
  )
  f.io.readTextFile = profileReads
  f.io.profileCandidates = () => ['/discoverable-profile']
  f.io.isProcessAlive = () => true
  const authKinds: string[] = []
  f.io.fetch = async (_url, init) => {
    const auth = resolveRequestAuth({
      req: {
        headers: { authorization: new Headers(init?.headers).get('authorization') ?? '' },
      } as IncomingMessage,
      url: new URL('http://session-worker/invoke'),
      token: 'admin-token',
      webSessions: new WebSessionManager(),
      sessionGrants: access.grants,
      allowQueryToken: false,
      now: new Date(),
    })
    if (!auth) {
      return new Response(JSON.stringify({ ok: false, error: { code: 'common.forbidden' } }), {
        status: 401,
      })
    }
    authKinds.push(auth.kind)
    const result = await surface.invoke(
      { ...ctx, requestAuth: auth },
      JSON.parse(String(init?.body)),
    )
    return new Response(JSON.stringify(result))
  }
  return {
    ...access,
    env,
    identity,
    onSpawnIdentity,
    profileReads,
    authKinds,
    exit: () => exited({ sessionId: 'standalone', exitCode: 0 }),
    async cli(args: string[]) {
      let stdout = '',
        stderr = ''
      f.io.stdout.write = text => {
        stdout += text
      }
      f.io.stderr.write = text => {
        stderr += text
      }
      const code = await run(args, f.io)
      return {
        code,
        stdout,
        value: stdout ? JSON.parse(stdout) : undefined,
        error: stderr ? JSON.parse(stderr).error : undefined,
      }
    },
  }
}

it('preserves standalone interact authority, connection and shims without canvas identity', async () => {
  const f = await fixture()
  try {
    expect(f.env.OPENCOVE_CONTROL_TOKEN).toBeTruthy()
    expect(f.env).toMatchObject({
      OPENCOVE_ENV: '1',
      OPENCOVE_PROJECT_ID: 'p',
      OPENCOVE_SPACE_ID: 's',
      OPENCOVE_CONTROL_URL: 'http://session-worker',
      OPENCOVE_CLI: '/app/opencove.mjs',
      OPENCOVE_CLI_SHIM_DIRECTORY: '/shims',
    })
    expect(f.env.PATH).toBe(['/shims', '/bin'].join(delimiter))
    expect(f.env).not.toHaveProperty('OPENCOVE_NODE_ID')
    expect(f.onSpawnIdentity).not.toHaveBeenCalled()
    expect(canvasSpawnIdentity.run(f.identity!, localCanvasResidentContext)).toBe('none')
    expect(await f.cli(['whoami'])).toMatchObject({
      code: 0,
      value: {
        caller: 'session-grant',
        scope: 'interact',
        projectId: 'p',
        spaceId: 's',
        nodeId: null,
        sessionId: 'standalone',
      },
    })
    expect(await f.cli(['context'])).toMatchObject({
      code: 0,
      value: { self: { nodeId: null, node: null } },
    })
    expect(await f.cli(['node', 'list', '--space', 's'])).toMatchObject({
      code: 0,
      value: { nodes: [{ id: 'target' }] },
    })
    expect(
      await f.cli(['node', 'create', 'note', '--space', 's', '--text', 'Progress']),
    ).toMatchObject({ code: 0, value: { node: { id: 'created' } } })
    expect(await f.cli(['fs', 'read', '--uri', 'file:///repo/notes.txt'])).toMatchObject({
      code: 0,
      value: { content: 'File contents' },
    })
    expect(
      await f.cli([
        'api',
        'call',
        'session.stopNode',
        '--input',
        '{"nodeId":"target","sessionId":"agent-session","agentOnly":true}',
      ]),
    ).toMatchObject({ code: 0, value: { stopped: true } })
    expect(await f.cli(['api', 'call', 'workspace.approveRoot', '--input', '{}'])).toMatchObject({
      code: 4,
      stdout: '',
      error: { code: 'common.forbidden' },
    })
    expect(f.authKinds.every(kind => kind === 'session-grant')).toBe(true)
    expect(f.profileReads).not.toHaveBeenCalled()
  } finally {
    f.dispose()
  }
})
it.each(['exit', 'kill', 'dispose'] as const)(
  'revokes standalone access on %s without falling back to a discoverable admin profile',
  async action => {
    const f = await fixture()
    try {
      const token = f.env.OPENCOVE_CONTROL_TOKEN!
      const grant = f.grants.verify(token)
      expect(grant).toMatchObject({ nodeId: null, sessionId: 'standalone', tier: 'interact' })
      const revoked = vi.fn()
      f.grants.onRevoke(grant!.grantId, revoked)
      if (action === 'exit') {
        f.exit()
      } else if (action === 'kill') {
        f.runtime.kill('standalone')
      } else {
        f.dispose()
      }
      expect(f.grants.verify(token)).toBeNull()
      expect(revoked).toHaveBeenCalledOnce()
      expect(await f.cli(['whoami'])).toMatchObject({ code: 4, stdout: '' })
      expect(f.profileReads).not.toHaveBeenCalled()
    } finally {
      f.dispose()
    }
  },
)
