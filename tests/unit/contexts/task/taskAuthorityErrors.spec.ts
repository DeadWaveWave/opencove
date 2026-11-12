import { afterEach, expect, it } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import { createAppError } from '@shared/errors/appError'
import type { AppErrorCode } from '@shared/contracts/dto/error'

afterEach(async () => {
  await applyUiLanguage('en')
})
it.each(['en', 'zh-CN'] as const)('presents actionable task errors in %s', async language => {
  await applyUiLanguage(language)
  for (const code of [
    'task.closed',
    'task.claimed',
    'task.holder_busy',
    'task.stale',
    'task.text_stale',
    'task.text_too_large',
    'task.request_mismatch',
    'task.legacy_conflict',
  ] as AppErrorCode[]) {
    const message = toErrorMessage(createAppError(code))
    expect(message).not.toContain('messages.')
    expect(message).not.toBe(code)
    expect(message).toMatch(language === 'zh-CN' ? /[\u4e00-\u9fff]/ : /[A-Za-z]/)
  }
  expect(
    toErrorMessage(
      createAppError('persistence.owned_node_identity_conflict', {
        details: { authority: 'task' },
      }),
    ),
  ).toContain(language === 'zh-CN' ? '节点' : 'node')
})
