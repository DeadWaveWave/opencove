import { describe, expect, it, vi } from 'vitest'
import { TerminalAgentActivityEnvironmentService } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentActivityEnvironmentService'
import { terminalAgentAssetPaths } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryAssetManifest'
import { terminalAgentFailureReason } from '../../../src/contexts/agent/infrastructure/terminal-activity/TerminalAgentDiagnostics'

const command = {
  command: '/bin/zsh',
  args: ['-l'],
  cwd: '/workspace',
  interactiveShell: true,
  environment: { PATH: '/bin', SENTINEL: 'untouched' },
}

function fixture() {
  const dispose = vi.fn(async () => undefined)
  const reserveTerminal = vi.fn(async () => ({
    endpoint: 'http://127.0.0.1:1',
    token: 'fixture-only',
    commit: vi.fn(),
    dispose,
  }))
  const ensure = vi.fn(async () => terminalAgentAssetPaths('/private/instance'))
  const diagnostic = vi.fn()
  const service = new TerminalAgentActivityEnvironmentService({
    assets: { ensure },
    gateway: { reserveTerminal },
    diagnostic,
    inheritedPath: '/bin',
    inheritedShell: '/bin/zsh',
    platform: 'darwin',
  })
  return { service, ensure, reserveTerminal, dispose, diagnostic }
}

describe('terminal preparation failure diagnostics', () => {
  it('fails open even when diagnostics fail and allows a later preparation', async () => {
    const { service, ensure, reserveTerminal, diagnostic } = fixture()
    ensure.mockRejectedValueOnce(
      Object.assign(new Error('sensitive path or command'), { code: 'ENOSPC' }),
    )
    diagnostic.mockImplementationOnce(() => {
      throw new Error('log unavailable')
    })
    const prepared = await service.prepare(command)
    expect(prepared).toMatchObject({
      command: command.command,
      args: command.args,
      environment: command.environment,
    })
    expect(reserveTerminal).not.toHaveBeenCalled()
    expect(diagnostic).toHaveBeenCalledWith({
      type: 'prepare-fallback',
      stage: 'assets',
      reason: 'ENOSPC',
    })
    expect(await service.prepare(command)).toMatchObject({
      command: terminalAgentAssetPaths('/private/instance').shellLauncherPath,
    })
    expect(command.environment).toEqual({ PATH: '/bin', SENTINEL: 'untouched' })
  })

  it('releases a reservation if environment construction fails', async () => {
    const { service, ensure, dispose, diagnostic } = fixture()
    const assets = terminalAgentAssetPaths('/private/instance')
    Object.defineProperty(assets, 'shimDirectory', {
      get: () => {
        throw new Error('invalid asset')
      },
    })
    ensure.mockResolvedValue(assets)
    expect(await service.prepare(command)).toMatchObject({
      command: command.command,
      environment: command.environment,
    })
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(diagnostic).toHaveBeenCalledWith({
      type: 'prepare-fallback',
      stage: 'environment',
      reason: 'unavailable',
    })
  })

  it('does not wrap the shell if the gateway has shut down', async () => {
    const { service, reserveTerminal, diagnostic } = fixture()
    reserveTerminal.mockRejectedValueOnce(new Error('disposed'))
    expect(await service.prepare({ ...command, environment: undefined })).toMatchObject({
      command: command.command,
      environment: undefined,
    })
    expect(diagnostic).toHaveBeenCalledWith({
      type: 'prepare-fallback',
      stage: 'reservation',
      reason: 'unavailable',
    })
  })

  it('emits only allowlisted failure codes, never arbitrary exception content', () => {
    expect(terminalAgentFailureReason({ code: 'private argument', message: 'secret' })).toBe(
      'unavailable',
    )
    expect(terminalAgentFailureReason('sensitive path')).toBe('unavailable')
    expect(terminalAgentFailureReason({ code: 'EACCES' })).toBe('EACCES')
  })
})
