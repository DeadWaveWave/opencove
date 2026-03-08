import { describe, expect, it } from 'vitest'
import { buildTaskTitleCommand } from '../../../src/contexts/task/infrastructure/cli/TaskTitleCommandFactory'

describe('buildTaskTitleCommand', () => {
  it('uses codex exec with read-only sandbox and output file', () => {
    const command = buildTaskTitleCommand({
      provider: 'codex',
      requirement: 'Implement retry with exponential backoff',
      model: 'gpt-5.2-codex',
      outputFilePath: '/tmp/cove-title.txt',
      availableTags: ['feature', 'bug'],
    })

    expect(command.command).toBe('codex')
    expect(command.outputMode).toBe('file')
    expect(command.args).toContain('exec')
    expect(command.args).toContain('--sandbox')
    expect(command.args).toContain('read-only')
    expect(command.args).toContain('--skip-git-repo-check')
    expect(command.args).toContain('-c')
    expect(command.args).toContain('reasoning.effort="low"')
    expect(command.args).toContain('--model')
    expect(command.args).toContain('gpt-5.2-codex')
    expect(command.args).toContain('-o')
    expect(command.args).toContain('/tmp/cove-title.txt')
    expect(command.args[command.args.length - 1]).toContain('Available tags: feature, bug')
  })

  it('uses claude print mode with tools disabled', () => {
    const command = buildTaskTitleCommand({
      provider: 'claude-code',
      requirement: '实现登录重试与指数退避',
      model: null,
      outputFilePath: '/tmp/unused.txt',
      availableTags: ['feature', 'bug'],
    })

    expect(command.command).toBe('claude')
    expect(command.outputMode).toBe('stdout')
    expect(command.args[0]).toBe('-p')
    expect(command.args).toContain('--tools')
    expect(command.args).toContain('')
    expect(command.args[command.args.length - 1]).toContain('Task requirement:')
  })

  it('rejects empty requirement', () => {
    expect(() =>
      buildTaskTitleCommand({
        provider: 'codex',
        requirement: '   ',
        model: null,
        outputFilePath: '/tmp/cove-title.txt',
        availableTags: ['feature', 'bug'],
      }),
    ).toThrow('Task requirement cannot be empty')
  })
})
