import { expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { createBuiltinAgentProviderContributions } from '../../../src/contexts/agent/infrastructure/providers/catalog/BuiltinAgentProviderCatalog'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'
import { parseClaude } from '../../fixtures/provider-argv/claudeParser.mjs'
import { parseCodex, parseStringOptions } from '../../fixtures/provider-argv/stringOptions.mjs'
import { parseArgs } from '../../fixtures/provider-argv/pi.mjs'

const resolver = new TerminalProfileResolver({
  platform: 'win32',
  env: () => ({}),
  homeDir: () => 'C:\\Users\\fixture',
  processCwd: () => 'C:\\project',
  locateWindowsCommands: async () => [],
  listWslDistros: async () => ['Ubuntu'],
})
// PowerShell single-quoted literals only: doubled quotes decode to one, and $/backticks
// remain literal. Require the entire invocation to consist of these tokens.
function powershellArgv(script: string): string[] {
  const start = script.indexOf('; & ') + 4
  expect(start).toBeGreaterThan(3)
  const invocation = script.slice(start, -'; exit $LASTEXITCODE'.length)
  const tokens = [...invocation.matchAll(/'((?:[^']|'')*)'/g)]
  expect(tokens.map(token => token[0]).join(' ')).toBe(invocation)
  return tokens.map(token => token[1].replaceAll("''", "'"))
}
for (const provider of createBuiltinAgentProviderContributions({ runtimePlatform: 'win32' })) {
  it.each(['powershell', 'wsl:Ubuntu'])(
    `${provider.descriptor.id} preserves final %s argument boundaries`,
    async profileId => {
      const prompt = 'Explain\r\n中文 "double" and \'single\'; $x `literal` $(echo hi)'
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
        const argv =
          profileId === 'powershell'
            ? powershellArgv(spawn.args.at(-1)!)
            : spawn.args.slice(spawn.args.indexOf(managed.plan.command))
        expect(argv).toEqual([managed.plan.command, ...managed.plan.args])
        const args = argv.slice(1)
        const id = provider.descriptor.id
        const actual =
          id === 'claude-code'
            ? parseClaude(args).prompt
            : id === 'codex'
              ? parseCodex(args).prompt
              : id === 'pi'
                ? parseArgs(args).messages[0]
                : parseStringOptions(id, args).values[
                    id === 'gemini' ? '--prompt-interactive' : '--prompt'
                  ]
        expect(actual).toBe(prompt)
      } finally {
        await managed.artifacts.dispose()
      }
    },
  )
}
