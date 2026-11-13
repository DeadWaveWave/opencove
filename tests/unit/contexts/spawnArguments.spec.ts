import { expect, it } from 'vitest'
import { preparePtySpawnArguments } from '../../../src/platform/process/spawnArguments'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'

for (const platform of ['darwin', 'linux', 'win32'] as const) {
  it.each(['command', 'argument', 'cwd'])(
    'rejects native NUL in %s on ' + platform,
    async field => {
      const command = field === 'command' ? 'receiver\0.exe' : 'receiver'
      const args = [field === 'argument' ? 'plugins\0 explain' : 'ordinary']
      const cwd = field === 'cwd' ? '/tmp\0other' : '/tmp'
      expect(() => preparePtySpawnArguments(command, args, cwd, platform)).toThrow()
      await expect(
        new TerminalProfileResolver({ platform }).resolveCommandSpawn({ command, args, cwd }),
      ).rejects.toMatchObject({
        code: 'common.invalid_input',
        details: { reason: 'invalid_spawn_arguments' },
      })
    },
  )
}
it('validates original values before PowerShell can encode them into its private transport', async () => {
  await expect(
    new TerminalProfileResolver({ platform: 'win32' }).resolveCommandSpawn({
      command: 'receiver',
      args: ['plugins\0 explain'],
      cwd: 'C:\\project',
      profileId: 'powershell',
    }),
  ).rejects.toMatchObject({ details: { reason: 'invalid_spawn_arguments' } })
})
