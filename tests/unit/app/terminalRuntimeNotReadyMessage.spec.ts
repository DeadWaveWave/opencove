import { applyUiLanguage } from '@app/renderer/i18n'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import { createAppErrorDescriptor } from '@shared/errors/appError'

describe('terminal runtime readiness message', () => {
  it('formats the typed admission error in both supported languages', async () => {
    const error = createAppErrorDescriptor('terminal.runtime_not_ready')

    await applyUiLanguage('en')
    expect(toErrorMessage(error)).toBe(
      'Terminal recovery is still in progress. Please wait a moment and try again.',
    )

    await applyUiLanguage('zh-CN')
    expect(toErrorMessage(error)).toBe('终端仍在恢复中，请稍候重试。')

    await applyUiLanguage('en')
  })
})
