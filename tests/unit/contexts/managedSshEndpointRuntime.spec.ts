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

  it('returns an error snapshot when ssh is unavailable', async () => {
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () =>
        createSshAvailability({
          executablePath: null,
          source: null,
          status: 'not_found',
          diagnostics: ['ssh is not installed'],
        }),
    })

    const prepared = await runtime.prepare(createAccess())

    expect(prepared.connection).toBeNull()
    expect(prepared.bootstrapRan).toBe(false)
    expect(prepared.snapshot.status).toBe('error')
    expect(prepared.snapshot.lastError).toContain('ssh is not installed')
  })

  it('reuses the same in-flight prepare call for concurrent requests', async () => {
    const tunnelProcess = createTunnelProcess()
    let releaseWait: (() => void) | null = null

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41001,
      spawnTunnelProcess: vi.fn(() => tunnelProcess),
      probeConnection: async () => true,
      waitForCondition: async fn => {
        await new Promise<void>(resolve => {
          releaseWait = resolve
        })
        return await fn()
      },
    })

    const firstPromise = runtime.prepare(createAccess())
    const secondPromise = runtime.prepare(createAccess())

    await new Promise(resolve => setTimeout(resolve, 0))
    releaseWait?.()

    const [first, second] = await Promise.all([firstPromise, secondPromise])

    expect(first).toEqual(second)
    expect(first.connection).toEqual({
      hostname: '127.0.0.1',
      port: 41001,
      token: 'managed-token',
    })
  })

  it('runs the matching-version bootstrap and reconnects when the remote worker is not ready yet', async () => {
    const firstTunnel = createTunnelProcess()
    const secondTunnel = createTunnelProcess()
    const access = createAccess()
    const probeConnection = vi
      .fn<[{ hostname: string; port: number; token: string }, number], Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    const runBootstrap = vi.fn(async () => undefined)

    const runtime = createManagedSshEndpointRuntime({
      appVersion: '0.3.0',
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: vi.fn(async () => 41002),
      spawnTunnelProcess: vi
        .fn()
        .mockReturnValueOnce(firstTunnel)
        .mockReturnValueOnce(secondTunnel),
      probeConnection,
      runBootstrap,
      waitForCondition: async fn => await fn(),
    })

    const prepared = await runtime.prepare(access, {
      allowBootstrap: true,
    })

    expect(runBootstrap).toHaveBeenCalledTimes(1)
    expect(runBootstrap).toHaveBeenCalledWith('/usr/bin/ssh', access, {
      reinstallRuntime: undefined,
      appVersion: '0.3.0',
    })
    expect(prepared.bootstrapRan).toBe(true)
    expect(prepared.connection).toEqual({
      hostname: '127.0.0.1',
      port: 41002,
      token: 'managed-token',
    })
    expect(firstTunnel.kill).toHaveBeenCalledTimes(1)
  })

  it('classifies a corrupt runtime bootstrap failure in the runtime snapshot', async () => {
    const tunnelProcess = createTunnelProcess()
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41006,
      spawnTunnelProcess: vi.fn(() => tunnelProcess),
      probeConnection: async () => false,
      waitForCondition: async () => false,
      runBootstrap: async () => {
        throw new ManagedSshBootstrapError(
          'runtime_corrupt',
          '[opencove-bootstrap:runtime_corrupt] dyld: Library not loaded',
        )
      },
    })

    const prepared = await runtime.prepare(createAccess())

    expect(prepared.connection).toBeNull()
    expect(prepared.snapshot).toMatchObject({
      status: 'error',
      failureKind: 'runtime_corrupt',
      lastError: expect.stringContaining('dyld: Library not loaded'),
    })
  })

  it('restarts the tunnel when reconnect is requested', async () => {
    const firstTunnel = createTunnelProcess()
    const secondTunnel = createTunnelProcess()

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: vi.fn().mockResolvedValueOnce(41003).mockResolvedValueOnce(41004),
      spawnTunnelProcess: vi
        .fn()
        .mockReturnValueOnce(firstTunnel)
        .mockReturnValueOnce(secondTunnel),
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
    })

    await runtime.prepare(createAccess())
    const restarted = await runtime.prepare(createAccess(), {
      restartTunnel: true,
    })

    expect(firstTunnel.kill).toHaveBeenCalledTimes(1)
    expect(restarted.connection).toEqual({
      hostname: '127.0.0.1',
      port: 41004,
      token: 'managed-token',
    })
  })

  it('stops the old tunnel before preparing changed connection parameters', async () => {
    const firstTunnel = createTunnelProcess()
    const secondTunnel = createTunnelProcess()
    const spawnTunnelProcess = vi
      .fn()
      .mockReturnValueOnce(firstTunnel)
      .mockReturnValueOnce(secondTunnel)
    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: vi.fn().mockResolvedValueOnce(41003).mockResolvedValueOnce(41004),
      spawnTunnelProcess,
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
    })

    await runtime.prepare(createAccess())
    const updatedAccess = createAccess()
    updatedAccess.ssh.port = 2222
    const restarted = await runtime.prepare(updatedAccess)

    expect(firstTunnel.kill).toHaveBeenCalledTimes(1)
    expect(spawnTunnelProcess).toHaveBeenNthCalledWith(2, '/usr/bin/ssh', updatedAccess, 41004)
    expect(restarted.connection?.port).toBe(41004)
  })

  it('records an error snapshot when the tunnel exits unexpectedly', async () => {
    const tunnelProcess = createTunnelProcess()

    const runtime = createManagedSshEndpointRuntime({
      getSshAvailability: async () => createSshAvailability(),
      reserveLoopbackPort: async () => 41005,
      spawnTunnelProcess: vi.fn(() => tunnelProcess),
      probeConnection: async () => true,
      waitForCondition: async fn => await fn(),
    })

    await runtime.prepare(createAccess())
    tunnelProcess.stderr.emit('data', Buffer.from('broken pipe\n'))
    tunnelProcess.exitCode = 255
    tunnelProcess.emit('exit', 255)

    expect(runtime.getSnapshot('managed-1')).toMatchObject({
      endpointId: 'managed-1',
      status: 'error',
      localPort: null,
      lastError: 'broken pipe',
      failureKind: 'tunnel_failed',
    })
  })
})
