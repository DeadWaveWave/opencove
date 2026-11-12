import { describe, expect, it, vi } from 'vitest'
import { describeAgentLaunchCommand } from '../../../src/app/main/diagnostics/agentLaunchRuntimeDiagnostics'

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn(() => '/tmp/opencove-test-user-data'),
  },
}))

describe('agent launch runtime diagnostics', () => {
  it('redacts a codex prompt after an option terminator', () => {
    const details = describeAgentLaunchCommand({
      provider: 'codex',
      mode: 'new',
      cwd: '/workspace',
      command: 'codex',
      args: [
        '--dangerously-bypass-approvals-and-sandbox',
        '--model',
        'gpt-5.2-codex',
        '--',
        '- secret prompt',
      ],
    })

    const argsShape = String(details.argsShape)
    expect(argsShape).toContain('<redacted:codex-prompt:index=4:len=15>')
    expect(argsShape).not.toContain('- secret prompt')
  })

  it('does not treat post-terminator claude prompt text as a flag', () => {
    const details = describeAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'new',
      cwd: '/workspace',
      command: 'claude',
      args: ['--dangerously-skip-permissions', '--', '- secret prompt'],
    })

    const argsShape = String(details.argsShape)
    expect(argsShape).toContain('<arg:index=2:len=15>')
    expect(argsShape).not.toContain('- secret prompt')
  })

  it('shows the claude permission mode so support can tell a safe launch from a bypassed one', () => {
    const details = describeAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'resume',
      cwd: '/workspace',
      command: 'claude',
      args: ['--permission-mode', 'default', '--resume', 'session-secret'],
    })

    const argsShape = String(details.argsShape)
    expect(argsShape).toContain('"--permission-mode","default"')
    expect(argsShape).not.toContain('session-secret')
  })
})
