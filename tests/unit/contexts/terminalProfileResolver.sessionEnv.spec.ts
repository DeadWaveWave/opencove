import { describe, expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { agentConfigurationEnv, parentAgentSessionEnv } from '../../support/parentAgentSessionEnv'

describe('TerminalProfileResolver session environment isolation', () => {
  const env = { ...parentAgentSessionEnv, ...agentConfigurationEnv }
  const createResolver = (platform: NodeJS.Platform) =>
    new TerminalProfileResolver({
      platform,
      env: () => env,
      homeDir: () => 'C:\\Users\\tester',
      locateWindowsCommands: async () => [],
      listWslDistros: async () => ['Ubuntu'],
    })

  it.each(['darwin', 'linux', 'win32'] as const)(
    'sanitizes inherited and explicit terminal/agent environments on %s',
    async platform => {
      const resolver = createResolver(platform)
      const terminal = await resolver.resolveTerminalSpawn({
        cwd: '/repo',
        cols: 80,
        rows: 24,
        env,
      })
      const agent = await resolver.resolveCommandSpawn({
        cwd: '/repo',
        command: 'claude',
        args: [],
        env,
      })

      for (const result of [terminal, agent]) {
        for (const key of Object.keys(parentAgentSessionEnv)) {
          expect(Object.hasOwn(result.env, key)).toBe(false)
        }
        expect(result.env).toMatchObject(agentConfigurationEnv)
      }
      expect(env).toStrictEqual({ ...parentAgentSessionEnv, ...agentConfigurationEnv })
    },
  )

  it.each(['commandEnv', 'env'] as const)(
    'does not embed parent session keys from %s in WSL command arguments',
    async envSource => {
      const result = await createResolver('win32').resolveCommandSpawn({
        cwd: 'C:\\repo',
        command: 'claude',
        args: ['--resume', 'owned-session'],
        profileId: 'wsl:Ubuntu',
        [envSource]: env,
      })

      expect(result.runtimeKind).toBe('wsl')
      for (const key of Object.keys(parentAgentSessionEnv)) {
        expect(result.args.some(arg => arg.startsWith(`${key}=`))).toBe(false)
      }
      expect(result.args).toContain('CLAUDE_CODE_USE_BEDROCK=1')
      expect(result.args).toContain(`ANTHROPIC_BASE_URL=${env.ANTHROPIC_BASE_URL}`)
      expect(result.args.slice(-3)).toEqual(['claude', '--resume', 'owned-session'])
    },
  )
})
