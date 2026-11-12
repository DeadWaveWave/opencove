// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { parseClaude } from '../../fixtures/provider-argv/claudeParser.mjs'
import { receivePowerShellSpawn, receiveWindowsSpawn } from '../../support/windowsPlatformReceiver'
import { parseWindowsArguments } from '../../support/windowsCommandLine'

const resolver = new TerminalProfileResolver({
  platform: 'win32',
  env: () => ({}),
  homeDir: () => 'C:\\Users\\fixture',
  processCwd: () => 'C:\\project',
  locateWindowsCommands: async commands => (commands.includes('pwsh.exe') ? ['pwsh.exe'] : []),
  listWslDistros: async () => ['Ubuntu'],
})
const prompts = [
  '"update"',
  '"plugins"',
  'Explain " --agent-teams " please',
  '$(printf update)',
  '" --agent-teams "',
  '"two words"',
  '中文 😀\\',
  'Explain\r\n"quotes" \\ and \'single\'; $x `literal`',
  'C:\\folder with space\\',
]
for (const provider of createBuiltinAgentProviderContributions({ runtimePlatform: 'win32' })) {
  for (const profileId of ['powershell', 'pwsh', 'wsl:Ubuntu']) {
    it.each(prompts)(
      `${provider.descriptor.id}/${profileId} preserves final receiver operand %j`,
      async prompt => {
        const managed = await createManagedAgentLaunchPlan(provider, {
          mode: 'new',
          prompt,
          model: 'chosen',
          resumeSessionId: null,
          agentFullAccess: provider.descriptor.id === 'kimi',
          workspaceDirectory: 'C:\\project',
          opencodeServer: { hostname: '127.0.0.1', port: 12345 },
        })
        try {
          const spawn = await resolver.resolveCommandSpawn({
            profileId,
            cwd: 'C:\\project',
            command: managed.plan.command,
            args: [...managed.plan.args],
          })
          let argv: string[]
          if (profileId.startsWith('wsl:')) {
            const received = receiveWindowsSpawn(spawn.command, spawn.args)
            const exec = received.indexOf('--exec')
            expect(exec).toBeGreaterThan(0)
            argv = received.slice(exec + 1)
          } else {
            argv = receivePowerShellSpawn(spawn.command, spawn.args, spawn.env)
          }
          expect(argv).toEqual([managed.plan.command, ...managed.plan.args])
          if (provider.descriptor.id === 'claude-code') {
            expect(parseClaude(argv.slice(1))).toMatchObject({
              prompt,
              command: undefined,
              raw: [],
              connect: undefined,
            })
          }
        } finally {
          await managed.artifacts.dispose()
        }
      },
    )
  }
}
it('WSL receiver preserves env and never executes command substitution', async () => {
  const spawn = await resolver.resolveCommandSpawn({
    profileId: 'wsl:Ubuntu',
    cwd: 'C:\\project',
    command: '/usr/bin/printf',
    args: ['%s', '$(printf update)'],
    commandEnv: { FIXTURE: '"env with spaces"' },
  })
  const received = receiveWindowsSpawn(spawn.command, spawn.args)
  const args = received.slice(received.indexOf('--exec') + 1)
  expect(args.slice(0, 2)).toEqual(['env', 'FIXTURE="env with spaces"'])
  expect(execFileSync(args[0], args.slice(1), { encoding: 'utf8' })).toBe('$(printf update)')
})
it('negative controls demonstrate the missing native/shell stages', () => {
  // PowerShell legacy NeedQuotes treats quotes as grouping, then native CRT removes them.
  expect(parseWindowsArguments('"update"')).toEqual(['update'])
  expect(parseWindowsArguments('"Explain " --agent-teams " please"')).toContain('--agent-teams')
  expect(execFileSync('/bin/sh', ['-c', 'printf %s $(printf update)'], { encoding: 'utf8' })).toBe(
    'update',
  )
})
