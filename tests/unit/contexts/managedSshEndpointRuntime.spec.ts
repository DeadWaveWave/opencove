import type { ManagedSshEndpointPreparationRequest } from '../../../src/contexts/topology/application/ports/ManagedSshEndpointPreparationPort'
import { EventEmitter } from 'node:events'
import type { ExecutableLocationResult } from '../../../src/platform/process/ExecutableLocator'
import type { ManagedSshEndpointRuntimeAccess } from '../../../src/app/main/controlSurface/topology/topologyEndpointAccess'
import { createManagedSshEndpointRuntime } from '../../../src/app/main/controlSurface/topology/managedSshEndpointRuntime'
import {
  buildInstallerAssetUrl,
  buildPosixBootstrapScript,
  buildSshArgs,
  buildSshTunnelArgs,
  ManagedSshBootstrapError,
} from '../../../src/app/main/controlSurface/topology/managedSshRuntimeSupport'

import { afterEach, describe, expect, it, vi } from 'vitest'

type MockTunnelProcess = EventEmitter & {
  exitCode: number | null
  stderr: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createAccess(): ManagedSshEndpointRuntimeAccess {
  return {
    endpointId: 'managed-1',
    displayName: 'SSH Box',
    token: 'managed-token',
    ssh: {
      host: 'example.com',
      port: 22,
      username: 'ubuntu',
      remotePort: 39291,
      remotePlatform: 'auto',
    },
  }
}

function createSshAvailability(
  overrides: Partial<ExecutableLocationResult> = {},
): ExecutableLocationResult {
  return {
    toolId: 'ssh',
    command: 'ssh',
    executablePath: '/usr/bin/ssh',
    source: 'path',
    status: 'resolved',
    diagnostics: [],
    ...overrides,
  }
}

function createTunnelProcess(): MockTunnelProcess {
  const process = new EventEmitter() as MockTunnelProcess
  process.exitCode = null
  process.stderr = new EventEmitter()
  process.kill = vi.fn(() => {
    process.exitCode = 0
    process.emit('exit', 0)
    return true
  })
  return process
}

function request(
  overrides: Partial<ManagedSshEndpointPreparationRequest> = {},
): ManagedSshEndpointPreparationRequest {
  return {
    operationId: 'operation-1',
    access: createAccess(),
    restartTunnel: false,
    reinstallRuntime: false,
    signal: new AbortController().signal,
    reportPhase: () => undefined,
    ...overrides,
  }
}

describe('managedSshEndpointRuntime', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('builds installer URLs that match stable and nightly release asset names', () => {
    expect(buildInstallerAssetUrl('posix', '0.2.1')).toBe(
      'https://github.com/DeadWaveWave/opencove/releases/download/v0.2.1/opencove-install-v0.2.1.sh',
    )
    expect(buildInstallerAssetUrl('windows', '0.2.1-nightly.20260811.1')).toBe(
      'https://github.com/DeadWaveWave/opencove/releases/download/v0.2.1-nightly.20260811.1/opencove-install-v0.2.1-nightly.20260811.1.ps1',
    )
    expect(buildInstallerAssetUrl('posix', null)).toBe(
      'https://github.com/DeadWaveWave/opencove/releases/latest/download/opencove-install.sh',
    )

    vi.stubEnv('OPENCOVE_RELEASE_BASE_URL', 'https://releases.example.test/custom')
    expect(buildInstallerAssetUrl('posix', '0.2.1')).toBe(
      'https://releases.example.test/custom/opencove-install.sh',
    )
  })

  it('puts tunnel options before the SSH destination for real OpenSSH', () => {
    expect(buildSshTunnelArgs(createAccess(), ['-N', '-L', '41000:127.0.0.1:39291'])).toEqual([
      '-p',
      '22',
      '-N',
      '-L',
      '41000:127.0.0.1:39291',
      'ubuntu@example.com',
    ])
  })

  it('keeps remote commands after the SSH destination', () => {
    expect(buildSshArgs(createAccess(), ['sh', '-lc', 'printf ok'])).toEqual([
      '-p',
      '22',
      'ubuntu@example.com',
      'sh',
      '-lc',
      'printf ok',
    ])
  })

  it('forces IPv4 for localhost while preserving the localhost SSH config host key', () => {
    const access = createAccess()
    access.ssh.host = 'localhost'

    expect(buildSshTunnelArgs(access, ['-N'])).toEqual([
      '-p',
      '22',
      '-o',
      'AddressFamily=inet',
      '-N',
      'ubuntu@localhost',
    ])
  })

  it('health-checks an existing posix runtime and bounds repair to one installer attempt', () => {
    const script = buildPosixBootstrapScript(createAccess(), {
      devRepoRoot: null,
      installerUrl: 'https://example.invalid/opencove-install.sh',
      reinstallRuntime: false,
    })

    expect(script).toContain('runtime_is_healthy()')
    expect(script).toContain('opencove worker start --help > "$health_log" 2>&1')
    expect(script).toContain('[ "$force_reinstall" = "1" ] || ! runtime_is_healthy')
    expect(script).toContain('prepare_repair_target()')
    expect(script).toContain('resolved_launcher="$(command -v opencove 2>/dev/null || true)"')
    expect(script).toContain('[opencove-bootstrap:runtime_unmanaged]')
    expect(script.match(/curl -fsSL/g)).toHaveLength(1)
    expect(script).toContain('[opencove-bootstrap:runtime_corrupt]')
    expect(script).toContain('after one repair attempt')
  })

  it('polls the managed worker and returns the remote bootstrap log on startup failure', () => {
    const script = buildPosixBootstrapScript(createAccess(), {
      devRepoRoot: null,
      installerUrl: 'https://example.invalid/opencove-install.sh',
      reinstallRuntime: false,
    })

    expect(script).toContain("endpoint_id='managed-1'")
    expect(script).toContain('/opencove/managed-ssh/$endpoint_id')
    expect(script).toContain('managed-worker.log')
    expect(script).toContain('--user-data "$user_data_dir"')
    expect(script).toContain('http://127.0.0.1:39291/invoke')
    expect(script).toContain('authorization: Bearer managed-token')
    expect(script).toContain('[ "$force_reinstall" != "1" ] && worker_is_ready')
    expect(script.indexOf('worker_is_ready; then')).toBeLessThan(script.indexOf('repair_needed=0'))
    expect(script).toContain('OpenCove worker did not become ready after SSH bootstrap.')
    expect(script).toContain('tail -n 80 "$log_file" >&2')
  })

  it('uses the mounted source repo as a dev bootstrap runtime before downloading installers', () => {
    const script = buildPosixBootstrapScript(createAccess(), {
      devRepoRoot: '/root/opencove-wsl-deploy',
      installerUrl: 'https://example.invalid/opencove-install.sh',
      reinstallRuntime: false,
    })

    expect(script).toContain('find_opencove_dev_repo_root')
    expect(script).toContain("configured_root='/root/opencove-wsl-deploy'")
    expect(script).toContain('"$HOME/opencove-wsl-deploy"')
    expect(script).toContain('[ -f "$repo_root/out/main/worker.js" ]')
    expect(script).toContain('cd "$OPENCOVE_MANAGED_SSH_DEV_REPO_ROOT"')
    expect(script).toContain('exec node out/main/worker.js "$@"')
    expect(script.indexOf('out/main/worker.js')).toBeLessThan(script.indexOf('curl -fsSL'))
  })

  it('returns a typed error snapshot when ssh is unavailable', async () => {
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () =>
        createSshAvailability({
          executablePath: null,
          status: 'not_found',
          diagnostics: ['ssh is not installed'],
        }),
    })
    expect(await runtime.execute(request())).toMatchObject({
      status: 'failed',
      failureKind: 'tunnel_failed',
    })
    expect(runtime.getSnapshot('managed-1')).toMatchObject({
      status: 'error',
      lastError: 'ssh is not installed',
    })
    await runtime.dispose()
  })

  it('bootstraps before reserving, spawning or probing a cold tunnel', async () => {
    let release!: () => void
    let started!: () => void
    const gate = new Promise<void>(resolve => {
      release = resolve
    })
    const bootstrapStarted = new Promise<void>(resolve => {
      started = resolve
    })
    const reserve = vi.fn(async () => 41001)
    const spawn = vi.fn(() => createTunnelProcess())
    const probe = vi.fn(async () => true)
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: reserve,
      spawnTunnelProcess: spawn,
      probeConnection: probe,
      waitForCondition: async fn => await fn(),
      runBootstrap: async () => {
        started()
        await gate
      },
    })
    const phases: string[] = []
    const execution = runtime.execute(request({ reportPhase: phase => phases.push(phase) }))
    await bootstrapStarted
    expect(runtime.getSnapshot('managed-1')).toMatchObject({
      status: 'connecting',
      failureKind: null,
    })
    expect(reserve).not.toHaveBeenCalled()
    expect(spawn).not.toHaveBeenCalled()
    expect(probe).not.toHaveBeenCalled()
    expect(await runtime.resolveConnection(createAccess())).toBeNull()
    release()
    expect(await execution).toEqual({ status: 'ready' })
    expect(phases).toEqual(['checking_prerequisites', 'opening_tunnel', 'verifying_connection'])
    expect(runtime.getSnapshot('managed-1')).toMatchObject({ status: 'ready', localPort: 41001 })
    await runtime.dispose()
  })

  it('keeps cold connection resolution read-only until explicit preparation succeeds', async () => {
    const reserve = vi.fn(async () => 41006)
    const spawn = vi.fn(() => createTunnelProcess())
    const probe = vi.fn(async () => true)
    const bootstrap = vi.fn(async () => undefined)
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: reserve,
      spawnTunnelProcess: spawn,
      probeConnection: probe,
      waitForCondition: async fn => await fn(),
      runBootstrap: bootstrap,
    })
    try {
      expect(await runtime.resolveConnection(createAccess())).toBeNull()
      expect(runtime.getSnapshot('managed-1')).toBeNull()
      expect(reserve).not.toHaveBeenCalled()
      expect(spawn).not.toHaveBeenCalled()
      expect(probe).not.toHaveBeenCalled()
      expect(bootstrap).not.toHaveBeenCalled()
      expect(await runtime.execute(request())).toEqual({ status: 'ready' })
      expect(await runtime.resolveConnection(createAccess())).toEqual({
        hostname: '127.0.0.1',
        port: 41006,
        token: 'managed-token',
      })
      const changedAccess = { ...createAccess(), token: 'replaced-token' }
      expect(await runtime.resolveConnection(changedAccess)).toBeNull()
      expect(await runtime.resolveConnection(createAccess())).not.toBeNull()
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(bootstrap).toHaveBeenCalledTimes(1)
    } finally {
      await runtime.dispose()
    }
  })

  it('does not restart a failed tunnel or overwrite its failure through connection resolution', async () => {
    const child = createTunnelProcess()
    const spawn = vi.fn(() => child)
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41007,
      spawnTunnelProcess: spawn,
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
      runBootstrap: async () => undefined,
    })
    try {
      await runtime.execute(request())
      child.exitCode = 255
      child.emit('exit', 255)
      const failed = runtime.getSnapshot('managed-1')
      expect(await runtime.resolveConnection(createAccess())).toBeNull()
      expect(spawn).toHaveBeenCalledTimes(1)
      expect(runtime.getSnapshot('managed-1')).toEqual(failed)
    } finally {
      await runtime.dispose()
    }
  })

  it('reuses a matching healthy tunnel without bootstrapping', async () => {
    const bootstrap = vi.fn(async () => undefined)
    const spawn = vi.fn(() => createTunnelProcess())
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41002,
      spawnTunnelProcess: spawn,
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
      runBootstrap: bootstrap,
    })
    await runtime.execute(request())
    bootstrap.mockClear()
    expect(await runtime.execute(request({ operationId: 'second' }))).toEqual({ status: 'ready' })
    expect(bootstrap).not.toHaveBeenCalled()
    expect(spawn).toHaveBeenCalledTimes(1)
    await runtime.dispose()
  })

  it('stops the old tunnel before forced reinstall and uses matching-version bootstrap', async () => {
    const first = createTunnelProcess()
    const bootstrap = vi.fn(async () => undefined)
    const runtime = createManagedSshEndpointRuntime({
      appVersion: '0.3.0',
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41003,
      spawnTunnelProcess: vi
        .fn()
        .mockReturnValueOnce(first)
        .mockReturnValueOnce(createTunnelProcess()),
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
      runBootstrap: bootstrap,
    })
    await runtime.execute(request())
    bootstrap.mockImplementation(async () => {
      expect(first.kill).toHaveBeenCalledTimes(1)
    })
    await runtime.execute(request({ operationId: 'second', reinstallRuntime: true }))
    expect(bootstrap).toHaveBeenLastCalledWith(
      '/usr/bin/ssh',
      createAccess(),
      expect.objectContaining({
        appVersion: '0.3.0',
        reinstallRuntime: true,
        signal: expect.anything(),
        reportPhase: expect.any(Function),
      }),
    )
    await runtime.dispose()
  })

  it('classifies bootstrap failure without opening a tunnel', async () => {
    const spawn = vi.fn()
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      spawnTunnelProcess: spawn,
      runBootstrap: async () => {
        throw new ManagedSshBootstrapError('runtime_corrupt', 'runtime unhealthy')
      },
    })
    expect(await runtime.execute(request())).toEqual({
      status: 'failed',
      failureKind: 'runtime_corrupt',
    })
    expect(runtime.getSnapshot('managed-1')).toMatchObject({
      status: 'error',
      lastError: 'runtime unhealthy',
    })
    expect(spawn).not.toHaveBeenCalled()
    await runtime.dispose()
  })

  it('does not spawn or resurrect state when disposed during a port reservation', async () => {
    let release!: (port: number) => void
    let reserved!: () => void
    const gate = new Promise<number>(resolve => {
      release = resolve
    })
    const started = new Promise<void>(resolve => {
      reserved = resolve
    })
    const spawn = vi.fn()
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => {
        reserved()
        return await gate
      },
      runBootstrap: async () => undefined,
      spawnTunnelProcess: spawn,
    })
    const execution = runtime.execute(request())
    await started
    const disposal = runtime.disposeEndpoint(createAccess())
    expect(runtime.getSnapshot('managed-1')).toBeNull()
    release(41001)
    expect(await execution).toEqual({ status: 'cancelled' })
    await disposal
    expect(spawn).not.toHaveBeenCalled()
    expect(runtime.getSnapshot('managed-1')).toBeNull()
  })

  it('records tunnel exit and unexpected adapter errors as final failure', async () => {
    const child = createTunnelProcess()
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41005,
      spawnTunnelProcess: () => child,
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
      runBootstrap: async () => undefined,
    })
    await runtime.execute(request())
    child.stderr.emit('data', Buffer.from('broken pipe\n'))
    child.exitCode = 255
    child.emit('exit', 255)
    expect(runtime.getSnapshot('managed-1')).toMatchObject({
      status: 'error',
      failureKind: 'tunnel_failed',
      lastError: 'broken pipe',
    })
    await runtime.dispose()
    const broken = createManagedSshEndpointRuntime({
      getSshAvailability: async () => {
        throw new Error('locator failed')
      },
    })
    expect(await broken.execute(request())).toEqual({ status: 'failed', failureKind: 'unknown' })
    expect(broken.getSnapshot('managed-1')).toMatchObject({
      status: 'error',
      lastError: 'locator failed',
    })
    await broken.dispose()
  })
})
