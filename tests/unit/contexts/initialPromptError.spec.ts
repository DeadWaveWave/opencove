import { expect, it } from 'vitest'
import { toErrorMessage } from '../../../src/app/renderer/shell/utils/format'
import { applyUiLanguage } from '../../../src/app/renderer/i18n'
import {
  terminalSpawnApplicationDescriptor,
  publicTerminalSpawnApplicationError,
} from '../../../src/shared/errors/terminalSpawnErrorReasons'
import { createAppError } from '../../../src/shared/errors/appError'

it('keeps fixed recovery guidance across public errors and both UI languages', async () => {
  const descriptor = terminalSpawnApplicationDescriptor('initial_prompt_unsupported')
  expect(publicTerminalSpawnApplicationError({ ...descriptor, debugMessage: 'untrusted' })).toEqual(
    descriptor,
  )
  await applyUiLanguage('en')
  expect(toErrorMessage(createAppError(descriptor))).toContain('Rephrase')
  await applyUiLanguage('zh-CN')
  expect(toErrorMessage(createAppError(descriptor))).toContain('已保留你的文本')
  await applyUiLanguage('en')
})

it.each([
  ['initial_prompt_contains_nul', 'Your text has been kept', '已保留你的文本'],
  ['invalid_spawn_arguments', 'launch settings', '启动设置'],
  ['wsl_arguments_unsupported', 'distribution name', '发行版'],
] as const)('keeps fixed bilingual guidance for %s', async (reason, en, zh) => {
  const descriptor = terminalSpawnApplicationDescriptor(reason)
  expect(publicTerminalSpawnApplicationError({ ...descriptor, debugMessage: 'untrusted' })).toEqual(
    descriptor,
  )
  await applyUiLanguage('en')
  expect(toErrorMessage(createAppError(descriptor))).toContain(en)
  await applyUiLanguage('zh-CN')
  expect(toErrorMessage(createAppError(descriptor))).toContain(zh)
  await applyUiLanguage('en')
})
