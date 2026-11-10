import { afterEach, expect, it } from 'vitest'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import { applyUiLanguage } from '@app/renderer/i18n'
import { createAppError } from '../../../src/shared/errors/appError'

afterEach(async () => {
  await applyUiLanguage('en')
})
it.each([
  ['no_parent', 'This node has no recorded parent.', '此节点没有记录的父节点。'],
  ['parent_deleted', 'The parent node has been deleted.', '父节点已被删除。'],
  [
    'caller_identity_required',
    'Select @parent from a session bound to an OpenCove canvas node.',
    '请在绑定到 OpenCove 画布节点的会话中使用 @parent。',
  ],
])('explains %s in both languages', async (reason, en, zh) => {
  const error = createAppError('node.parent_unavailable', { details: { reason } })
  await applyUiLanguage('en')
  expect(toErrorMessage(error)).toBe(en)
  await applyUiLanguage('zh-CN')
  expect(toErrorMessage(error.toDescriptor())).toBe(zh)
})
