import { describe, expect, it } from 'vitest'
import { buildAgentLaunchCommand } from '../../../src/contexts/agent/infrastructure/cli/AgentCommandFactory'

describe('buildAgentLaunchCommand', () => {
  it('builds codex command with model override', () => {
    const command = buildAgentLaunchCommand({
      provider: 'codex',
      mode: 'new',
      prompt: 'implement login flow',
      model: 'gpt-5.2-codex',
      resumeSessionId: null,
    })

    expect(command.command).toBe('codex')
    expect(command.args).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'gpt-5.2-codex',
      'implement login flow',
    ])
    expect(command.effectiveModel).toBe('gpt-5.2-codex')
    expect(command.launchMode).toBe('new')
  })

  it('adds option terminator when codex prompt starts with hyphen', () => {
    const command = buildAgentLaunchCommand({
      provider: 'codex',
      mode: 'new',
      prompt: '- implement login flow',
      model: 'gpt-5.2-codex',
      resumeSessionId: null,
    })

    expect(command.command).toBe('codex')
    expect(command.args).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
      '--model',
      'gpt-5.2-codex',
      '--',
      '- implement login flow',
    ])
    expect(command.launchMode).toBe('new')
  })

  it('builds codex command in safe mode when full access is disabled', () => {
    const command = buildAgentLaunchCommand({
      provider: 'codex',
      mode: 'new',
      prompt: '- implement login flow',
      model: 'gpt-5.2-codex',
      resumeSessionId: null,
      agentFullAccess: false,
    })

    expect(command.command).toBe('codex')
    expect(command.args).toEqual([
      '--full-auto',
      '--model',
      'gpt-5.2-codex',
      '--',
      '- implement login flow',
    ])
    expect(command.launchMode).toBe('new')
  })

  it('builds claude command without model override', () => {
    const command = buildAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'new',
      prompt: 'review failing tests',
      model: null,
      resumeSessionId: null,
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual(['--dangerously-skip-permissions', 'review failing tests'])
    expect(command.effectiveModel).toBeNull()
    expect(command.resumeSessionId).toBeNull()
  })

  it('builds claude command in safe mode when full access is disabled', () => {
    const command = buildAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'new',
      prompt: 'review failing tests',
      model: null,
      resumeSessionId: null,
      agentFullAccess: false,
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual(['review failing tests'])
    expect(command.effectiveModel).toBeNull()
    expect(command.resumeSessionId).toBeNull()
  })

  it('builds codex resume command with session id', () => {
    const command = buildAgentLaunchCommand({
      provider: 'codex',
      mode: 'resume',
      prompt: '',
      model: 'gpt-5.2-codex',
      resumeSessionId: '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
    })

    expect(command.command).toBe('codex')
    expect(command.args).toEqual([
      '--dangerously-bypass-approvals-and-sandbox',
      'resume',
      '019c3e32-52ff-7b00-94ac-e6c5a56b4aa4',
      '--model',
      'gpt-5.2-codex',
    ])
    expect(command.launchMode).toBe('resume')
  })

  it('rejects codex resume without explicit session id', () => {
    expect(() =>
      buildAgentLaunchCommand({
        provider: 'codex',
        mode: 'resume',
        prompt: '',
        model: null,
        resumeSessionId: null,
      }),
    ).toThrow('codex resume requires explicit session id')
  })

  it('builds claude resume command without explicit session id', () => {
    const command = buildAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'resume',
      prompt: '',
      model: null,
      resumeSessionId: null,
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual(['--dangerously-skip-permissions', '--continue'])
    expect(command.launchMode).toBe('resume')
  })

  it('supports starting codex without a prompt', () => {
    const command = buildAgentLaunchCommand({
      provider: 'codex',
      mode: 'new',
      prompt: '   ',
      model: null,
      resumeSessionId: null,
    })

    expect(command.command).toBe('codex')
    expect(command.args).toEqual(['--dangerously-bypass-approvals-and-sandbox'])
    expect(command.launchMode).toBe('new')
  })

  it('supports starting claude without a prompt', () => {
    const command = buildAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'new',
      prompt: '   ',
      model: null,
      resumeSessionId: null,
    })

    expect(command.command).toBe('claude')
    expect(command.args).toEqual(['--dangerously-skip-permissions'])
    expect(command.launchMode).toBe('new')
  })

  it('builds opencode command with local server metadata and prompt', () => {
    const command = buildAgentLaunchCommand({
      provider: 'opencode',
      mode: 'new',
      prompt: 'Ship the fix',
      model: 'openrouter/gpt-5',
      resumeSessionId: null,
      opencodeServer: {
        hostname: '127.0.0.1',
        port: 43123,
      },
    })

    expect(command.command).toBe('opencode')
    expect(command.args).toEqual([
      '--hostname',
      '127.0.0.1',
      '--port',
      '43123',
      '--model',
      'openrouter/gpt-5',
      '--prompt',
      'Ship the fix',
      '.',
    ])
    expect(command.launchMode).toBe('new')
  })

  it('builds gemini interactive prompt command', () => {
    const command = buildAgentLaunchCommand({
      provider: 'gemini',
      mode: 'new',
      prompt: 'Investigate the failing tests',
      model: 'gemini-3-flash-preview',
      resumeSessionId: null,
      agentFullAccess: true,
    })

    expect(command.command).toBe('gemini')
    expect(command.args).toEqual([
      '--yolo',
      '--model',
      'gemini-3-flash-preview',
      '--prompt-interactive',
      'Investigate the failing tests',
    ])
    expect(command.launchMode).toBe('new')
  })

  it('builds gemini resume command with explicit session id', () => {
    const command = buildAgentLaunchCommand({
      provider: 'gemini',
      mode: 'resume',
      prompt: '',
      model: null,
      resumeSessionId: 'd7d89910-fa86-4253-a183-07db548da987',
      agentFullAccess: false,
    })

    expect(command.command).toBe('gemini')
    expect(command.args).toEqual(['--resume', 'd7d89910-fa86-4253-a183-07db548da987'])
    expect(command.launchMode).toBe('resume')
  })
})
