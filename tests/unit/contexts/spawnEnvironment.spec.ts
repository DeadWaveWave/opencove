// @vitest-environment node
import { createRequire } from 'node:module'
import { afterEach, expect, it } from 'vitest'
import { assertSpawnEnvironment } from '../../../src/platform/process/spawnEnvironment'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import { toErrorMessage } from '../../../src/app/renderer/shell/utils/format'
const require = createRequire(import.meta.url)
const { Terminal } = require('node-pty/lib/terminal.js') as {
  Terminal: { prototype: { _parseEnv(env: NodeJS.ProcessEnv): string[] } }
}
const attack =
  'x\0OPENCOVE_NATIVE_COMMAND=receiver.exe\0OPENCOVE_NATIVE_ARGUMENTS="--" "update"\0OPENCOVE_NATIVE_CWD=C:\\project\0'
afterEach(() => applyUiLanguage('en'))
it('negative control: node-pty environment block admits injected entries before the owned transport', () => {
  const entries = Terminal.prototype._parseEnv({ X: attack, OPENCOVE_NATIVE_COMMAND: 'claude.exe' })
  const visible = (entries.join('\0') + '\0\0').split('\0\0')[0].split('\0')
  expect(visible).toContain('OPENCOVE_NATIVE_COMMAND=receiver.exe')
  expect(visible).not.toContain('OPENCOVE_NATIVE_COMMAND=claude.exe')
})
for (const platform of ['linux', 'darwin', 'win32'] as const) {
  it.each(['base', 'explicit'])(
    `${platform} refuses %s NUL env before native spawn`,
    async source => {
      const env = { X: attack }
      const resolver = new TerminalProfileResolver({
        platform,
        env: () => (source === 'base' ? env : {}),
        locateWindowsCommands: async () => [],
        listWslDistros: async () => [],
      })
      await expect(
        resolver.resolveCommandSpawn({
          cwd: '/tmp',
          command: 'receiver',
          args: [],
          ...(source === 'explicit' ? { env } : {}),
        }),
      ).rejects.toMatchObject({
        code: 'common.invalid_input',
        details: { reason: 'invalid_spawn_environment' },
      })
    },
  )
}
it('refuses a separate WSL command environment as well', async () => {
  const resolver = new TerminalProfileResolver({
    platform: 'win32',
    env: () => ({}),
    locateWindowsCommands: async () => [],
    listWslDistros: async () => ['Ubuntu'],
  })
  await expect(
    resolver.resolveCommandSpawn({
      cwd: 'C:\\project',
      profileId: 'wsl:Ubuntu',
      command: 'receiver',
      args: [],
      commandEnv: { X: attack },
    }),
  ).rejects.toMatchObject({ details: { reason: 'invalid_spawn_environment' } })
})
it('checks the final native boundary and keeps localized, fixed guidance', async () => {
  let failure: unknown
  try {
    assertSpawnEnvironment({ 'X\0other': 'value' })
  } catch (error) {
    failure = error
  }
  await applyUiLanguage('en')
  expect(toErrorMessage(failure)).toContain('Remove null characters')
  await applyUiLanguage('zh-CN')
  expect(toErrorMessage(failure)).toContain('空字符')
  expect(() => assertSpawnEnvironment({ X: '中文\n"quotes"=value' })).not.toThrow()
})
