import type { AgentProviderId } from '../../../../shared/contracts/dto'

export function resolveWorkerAgentTestStub(options: {
  provider: AgentProviderId
  cwd: string
  mode: 'new' | 'resume'
  model: string | null
}): { command: string; args: string[] } | null {
  if (process.env.NODE_ENV !== 'test') {
    return null
  }

  const wantsRealAgents =
    process.env['OPENCOVE_TEST_USE_REAL_AGENTS'] === '1' ||
    process.env['OPENCOVE_TEST_USE_REAL_AGENTS']?.toLowerCase() === 'true'
  if (wantsRealAgents) {
    return null
  }

  const sessionScenario = process.env['OPENCOVE_TEST_AGENT_SESSION_SCENARIO']?.trim() ?? ''
  const stubScriptPath = process.env['OPENCOVE_TEST_AGENT_STUB_SCRIPT']?.trim() ?? ''

  if (stubScriptPath.length > 0) {
    return {
      command: process.execPath,
      args: [
        stubScriptPath,
        options.provider,
        options.cwd,
        options.mode,
        options.model ?? 'default-model',
        sessionScenario.length > 0 ? sessionScenario : 'default',
      ],
    }
  }

  return {
    command: process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL ?? '/bin/zsh'),
    args:
      process.platform === 'win32'
        ? [
            '-NoLogo',
            '-NoProfile',
            '-Command',
            `Write-Output "[opencove-test-agent] ${options.provider} ${options.mode} ${
              options.model ?? 'default-model'
            }"; Start-Sleep -Seconds 120`,
          ]
        : [
            '-lc',
            `printf '%s\\n' "[opencove-test-agent] ${options.provider} ${options.mode} ${
              options.model ?? 'default-model'
            }"; sleep 120`,
          ],
  }
}
