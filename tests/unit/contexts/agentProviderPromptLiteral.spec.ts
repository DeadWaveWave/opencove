// @vitest-environment node
import { access, readFile, stat } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AGENT_PROVIDER_IDS } from '../../../src/shared/contracts/dto'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { describeAgentLaunchCommand } from '../../../src/app/main/diagnostics/agentLaunchRuntimeDiagnostics'

const prompts = [
  'logout',
  'update',
  'resume',
  'Refactor',
  '--continue',
  '--approve',
  '--dangerously-skip-permissions',
  '-p',
  'Explain the change',
  ' \n --approve',
  '--',
  '-',
  '--model=other',
  '--approve\nsecond line',
]
for (const provider of createBuiltinAgentProviderContributions({ runtimePlatform: 'linux' })) {
  describe(`${provider.descriptor.id} initial prompt encoding`, () => {
    it.each(prompts)('encodes %j without changing the launch mode', async input => {
      const prompt = input.trim()
      const managed = await createManagedAgentLaunchPlan(provider, {
        mode: 'new',
        prompt: input,
        model: null,
        resumeSessionId: null,
        agentFullAccess: provider.descriptor.id === 'kimi',
        workspaceDirectory: '/fixture',
        opencodeServer: { hostname: '127.0.0.1', port: 12345 },
      })
      let file: string | undefined
      try {
        const { args } = managed.plan
        expect(managed.plan.launchMode).toBe('new')
        const id = provider.descriptor.id
        if (id === 'pi' && prompt.startsWith('-')) {
          expect(args.at(-1)).toMatch(/^@/)
          file = args.at(-1)!.slice(1)
          expect(await readFile(file, 'utf8')).toBe(prompt)
          if (process.platform !== 'win32') {
            expect((await stat(file)).mode & 0o777).toBe(0o600)
          }
          expect(args).not.toContain(prompt)
        } else if (id === 'opencode') {
          expect(args.slice(-(prompt.startsWith('-') ? 2 : 3))).toEqual(
            prompt.startsWith('-') ? [`--prompt=${prompt}`, '.'] : ['--prompt', prompt, '.'],
          )
        } else if (id === 'gemini') {
          expect(args.slice(-(prompt.startsWith('-') ? 1 : 2))).toEqual(
            prompt.startsWith('-')
              ? [`--prompt-interactive=${prompt}`]
              : ['--prompt-interactive', prompt],
          )
        } else if (id === 'kimi') {
          expect(args.slice(-2)).toEqual(['--prompt', prompt])
        } else {
          expect(args.at(-1)).toBe(prompt)
          if (id === 'codex' || prompt.startsWith('-')) {
            expect(args.at(-2)).toBe('--')
          }
        }
        if (prompt.startsWith('-')) {
          const diagnostics = describeAgentLaunchCommand({
            provider: id,
            mode: 'new',
            command: managed.plan.command,
            args: [...args],
          })
          const shape = JSON.parse(String(diagnostics.argsShape)) as string[]
          if (prompt !== '--') {
            expect(shape).not.toContain(prompt)
          }
          expect(shape).not.toContain(`--prompt=${prompt}`)
          expect(shape).not.toContain(`--prompt-interactive=${prompt}`)
        }
      } finally {
        await managed.artifacts.dispose()
      }
      if (file) {
        await expect(access(file)).rejects.toThrow()
      }
    })
    it.each(['', ' \n '])('keeps empty prompt %j out of argv', async prompt => {
      const managed = await createManagedAgentLaunchPlan(provider, {
        mode: 'new',
        prompt,
        model: null,
        resumeSessionId: null,
        agentFullAccess: false,
        workspaceDirectory: '/fixture',
        opencodeServer: { hostname: '127.0.0.1', port: 12345 },
      })
      await managed.artifacts.dispose()
      expect(managed.plan.args).not.toContain('--')
      expect(managed.plan.args).not.toContain('--prompt')
      expect(managed.plan.args).not.toContain('--prompt-interactive')
      expect(managed.plan.args.some(arg => arg.startsWith('@'))).toBe(false)
    })
    it('keeps trusted resume semantics separate from the ignored initial prompt', async () => {
      const managed = await createManagedAgentLaunchPlan(provider, {
        mode: 'resume',
        prompt: '--approve',
        model: null,
        resumeSessionId: '11111111-1111-4111-8111-111111111111',
        agentFullAccess: false,
        workspaceDirectory: '/fixture',
        opencodeServer: { hostname: '127.0.0.1', port: 12345 },
      })
      await managed.artifacts.dispose()
      expect(managed.plan.launchMode).toBe('resume')
      expect(managed.plan.args).not.toContain('--approve')
      expect(managed.plan.args.some(arg => arg.startsWith('@'))).toBe(false)
    })
  })
}
it('covers every registered built-in provider', () => {
  expect(
    createBuiltinAgentProviderContributions()
      .map(provider => provider.descriptor.id)
      .sort(),
  ).toEqual([...AGENT_PROVIDER_IDS].sort())
})

for (const id of ['opencode', 'gemini'] as const) {
  it.each(['--continue', '--approve', '--dangerously-skip-permissions', '-p'])(
    `${id} keeps the sibling model value %j literal`,
    async model => {
      const provider = createBuiltinAgentProviderContributions().find(
        entry => entry.descriptor.id === id,
      )!
      const managed = await createManagedAgentLaunchPlan(provider, {
        mode: 'new',
        prompt: 'Explain the change',
        model,
        resumeSessionId: null,
        agentFullAccess: false,
        workspaceDirectory: '/fixture',
        opencodeServer: { hostname: '127.0.0.1', port: 12345 },
      })
      try {
        expect(managed.plan.args).toContain(`--model=${model}`)
        expect(managed.plan.args).not.toContain(model)
      } finally {
        await managed.artifacts.dispose()
      }
    },
  )
}
