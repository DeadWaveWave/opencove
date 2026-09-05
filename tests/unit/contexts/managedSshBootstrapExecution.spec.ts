import { beforeEach, describe, expect, it, vi } from 'vitest'
const { command } = vi.hoisted(() => ({ command: vi.fn() }))
vi.mock('../../../src/platform/process/runCommand', () => ({ runCommand: command }))
import { runManagedSshBootstrap } from '../../../src/app/main/controlSurface/topology/managedSshRuntimeSupport'

const access = {
  endpointId: 'bootstrap',
  displayName: 'Bootstrap',
  token: 'secret-sentinel',
  ssh: {
    host: 'example.test',
    port: 22,
    username: null,
    remotePort: 43254,
    remotePlatform: 'auto' as const,
  },
}

describe('managed SSH bootstrap execution', () => {
  beforeEach(() => {
    command.mockReset()
  })

  it('propagates cancellation rather than probing a different platform', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
    command.mockRejectedValue(abort)
    const controller = new AbortController()
    await expect(runManagedSshBootstrap('ssh', access, { signal: controller.signal })).rejects.toBe(
      abort,
    )
    expect(command).toHaveBeenCalledTimes(1)
    expect(command.mock.calls[0]?.[3]).toMatchObject({
      signal: controller.signal,
      captureMaxBytes: 262144,
    })
  })

  it('drains both bounded streams and publishes markers but not raw script output', async () => {
    const phases: string[] = []
    command.mockImplementation(async (_command, _args, _cwd, options) => {
      options.onStdout?.('[opencove-bootstrap-progress:v1] checking_remote_')
      options.onStdout?.('runtime\r\ninstaller noise\n')
      options.onStderr?.('[opencove-bootstrap-progress:v1] waiting_for_runtime\n')
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    await runManagedSshBootstrap(
      'ssh',
      { ...access, ssh: { ...access.ssh, remotePlatform: 'posix' } },
      {
        reportPhase: phase => phases.push(phase),
      },
    )
    expect(phases).toEqual(['detecting_platform', 'checking_remote_runtime', 'waiting_for_runtime'])
    expect(command.mock.calls[0]?.[3].captureMaxBytes).toBe(262144)
  })

  it('strips progress markers from terminal bootstrap errors without losing failure classification', async () => {
    command.mockResolvedValue({
      exitCode: 127,
      stdout: '',
      stderr:
        '[opencove-bootstrap-progress:v1] installing_runtime\n[opencove-bootstrap:runtime_corrupt] runtime unhealthy',
    })
    await expect(
      runManagedSshBootstrap('ssh', {
        ...access,
        ssh: { ...access.ssh, remotePlatform: 'posix' },
      }),
    ).rejects.toMatchObject({ failureKind: 'runtime_corrupt', message: 'runtime unhealthy' })
  })
})
