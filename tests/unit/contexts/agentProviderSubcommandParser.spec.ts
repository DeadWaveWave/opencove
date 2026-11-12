// @vitest-environment node
import { expect, it } from 'vitest'
import { parseClaude } from '../../fixtures/provider-argv/claudeParser.mjs'
import { parseArgs } from '../../fixtures/provider-argv/pi.mjs'
import { parsePackageCommand } from '../../fixtures/provider-argv/piPackage.mjs'
import { parseCodex, parseStringOptions } from '../../fixtures/provider-argv/stringOptions.mjs'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { assertProviderInitialPrompt } from '../../../src/contexts/agent/domain/providerInitialPromptPolicy'

const prompts = [
  'update',
  'upgrade',
  'config',
  'Refactor',
  '--help',
  '--agent-teams',
  '--hard-fail',
  '-p',
  '--approve',
  '--model=other',
  '--',
  '-',
  '@file',
  'Please inspect @file',
  'cc://localhost',
  'Explain\n中文 "quoted"; $x `id`',
  '--help\r\n第二行',
]
for (const provider of createBuiltinAgentProviderContributions({ runtimePlatform: 'linux' })) {
  const id = provider.descriptor.id
  for (const model of [null, 'chosen']) {
    it.each(prompts)(`${id}/${model} parses real generated argv for %j`, async prompt => {
      const input = {
        mode: 'new' as const,
        prompt,
        model,
        resumeSessionId: null,
        agentFullAccess: id === 'kimi',
        workspaceDirectory: '/fixture',
        opencodeServer: { hostname: '127.0.0.1', port: 12345 },
      }
      try {
        assertProviderInitialPrompt(id, prompt)
      } catch {
        await expect(createManagedAgentLaunchPlan(provider, input)).rejects.toMatchObject({
          code: 'common.invalid_input',
          details: { reason: 'initial_prompt_unsupported' },
        })
        return
      }
      const managed = await createManagedAgentLaunchPlan(provider, input)
      try {
        const args = [...managed.plan.args]
        if (id === 'claude-code') {
          const parsed = parseClaude(args)
          expect(parsed).toMatchObject({
            prompt,
            command: undefined,
            connect: undefined,
            raw: [],
            unknown: [],
          })
          expect(parsed.values['--permission-mode']).toBe('default')
          expect(parsed.values['--model']).toBe(model ?? undefined)
          expect(parsed.values['--session-id']).toBe(managed.plan.resumeSessionId)
        } else if (id === 'pi') {
          expect(parsePackageCommand(args)).toBeUndefined()
          expect(args[0]).not.toBe('config')
          const parsed = parseArgs(args)
          expect(parsed.messages).toEqual([prompt])
          expect(parsed.fileArgs).toEqual([])
          expect(parsed.unknownFlags.size).toBe(0)
          expect(parsed.model).toBe(model ?? undefined)
        } else if (id === 'codex') {
          expect(parseCodex(args)).toMatchObject({
            prompt,
            command: undefined,
            values: { '--sandbox': 'workspace-write', '--ask-for-approval': 'on-request' },
          })
        } else {
          const parsed = parseStringOptions(id, args)
          expect(parsed.values[id === 'gemini' ? '--prompt-interactive' : '--prompt']).toBe(prompt)
          expect(parsed.values['--model']).toBe(model ?? undefined)
          expect(parsed.operands).toEqual(id === 'opencode' ? ['.'] : [])
        }
      } finally {
        await managed.artifacts.dispose()
      }
    })
  }
}
it('negative controls independently expose delimiter, collision and raw-argv protection', () => {
  expect(parseClaude(['cc://localhost']).connect).toBe('cc://localhost')
  expect(parseClaude(['--', 'cc://localhost']).connect).toBeUndefined()
  expect(parseClaude(['--', 'update']).command).toBe('update')
  expect(parseClaude(['--', 'upgrade']).command).toBe('upgrade')
  expect(parseClaude(['--', '--agent-teams']).raw).toContain('--agent-teams')
  expect(parseClaude(['--', '--hard-fail']).raw).toContain('--hard-fail')
  expect(parsePackageCommand(['update'])?.command).toBe('update')
  expect(parseArgs(['--approve']).messages).toEqual([])
  expect(parseArgs(['@prompt.txt']).fileArgs).toEqual(['prompt.txt'])
  expect(parseCodex(['--model=other']).values).toHaveProperty('--model=other')
  expect(parseCodex(['resume']).command).toBe('resume')
  expect(() => parseStringOptions('gemini', ['--prompt-interactive', '--model=other'])).toThrow()
  expect(parseStringOptions('kimi', ['--prompt', '--model=other']).values['--prompt']).toBe(
    '--model=other',
  )
})

it.each(['claude-code', 'codex', 'opencode', 'gemini'] as const)(
  '%s retains prompt boundaries with injected hook arguments and a selected model',
  async provider => {
    const { buildAgentLaunchCommand } =
      await import('../../../src/contexts/agent/infrastructure/cli/AgentCommandFactory')
    const prompt = 'Explain\n中文 "quoted"; $value'
    const plan = buildAgentLaunchCommand({
      provider,
      mode: 'new',
      prompt,
      model: 'chosen',
      resumeSessionId: '11111111-1111-4111-8111-111111111111',
      agentFullAccess: false,
      injectedArgs:
        provider === 'codex'
          ? ['--config', 'notify=["/fixture/relay.mjs"]']
          : ['--settings', 'hook-config'],
      opencodeServer: { hostname: '127.0.0.1', port: 12345 },
    })
    const parsed =
      provider === 'claude-code'
        ? parseClaude(plan.args)
        : provider === 'codex'
          ? parseCodex(plan.args)
          : parseStringOptions(provider, plan.args)
    if (provider === 'claude-code' || provider === 'codex') {
      expect(parsed.prompt).toBe(prompt)
      expect(parsed.command).toBeUndefined()
    } else {
      expect(parsed.values[provider === 'gemini' ? '--prompt-interactive' : '--prompt']).toBe(
        prompt,
      )
    }
    expect(parsed.values['--model']).toBe('chosen')
  },
)
