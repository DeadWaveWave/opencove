import { afterEach, expect, it } from 'vitest'
import { applyUiLanguage } from '@app/renderer/i18n'
import { toErrorMessage } from '@app/renderer/shell/utils/format'
import { createAppError, createAppErrorDescriptor } from '@shared/errors/appError'

afterEach(async () => {
  await applyUiLanguage('en')
})
it('explains agent identity conflicts in both supported languages', async () => {
  const descriptor = createAppErrorDescriptor('persistence.owned_node_identity_conflict', {
    details: { nodeId: 'private-id', field: 'agent.provider' },
  })
  await applyUiLanguage('en')
  expect(toErrorMessage(descriptor)).toBe(
    'This agent has changed. Refresh the workspace and try again.',
  )
  await applyUiLanguage('zh-CN')
  expect(toErrorMessage(createAppError(descriptor))).toBe(
    '此智能体已发生变更，请刷新工作区后重试。',
  )
})
