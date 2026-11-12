import { toErrorMessage as toCanvasErrorMessage } from '../../../src/contexts/workspace/presentation/renderer/components/workspaceCanvas/helpers'
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

it.each([
  [
    'resumeBindingDrainExpired',
    'The latest Claude conversation could not be confirmed. Try resuming again before closing this agent.',
    '尚未确认最新 Claude 对话是否已保存。请先重试恢复，再关闭此智能体。',
  ],
  [
    'clientUpgradeRequired',
    'Update OpenCove and reload this window before controlling this agent.',
    '请更新 OpenCove 并重新加载此窗口，然后再操作此智能体。',
  ],
  [
    'workerUpgradeRequired',
    'Update and restart the connected Worker before managing Claude agents. Updating this window alone is not enough.',
    '请升级并重启当前连接的 Worker 后再操作 Claude 智能体。仅更新此窗口无法解决此问题。',
  ],
  [
    'writesDisabled',
    'Managed Claude restarts and saving new resume targets are paused. Existing saved targets remain protected. Ask the Worker administrator to enable updates.',
    'Claude 智能体重启及新恢复目标的保存已暂停。已保存的目标仍受保护，请联系 Worker 管理员恢复更新。',
  ],
])('explains %s in both supported languages', async (reason, english, chinese) => {
  const error = createAppError('agent.managed_launch_rejected', { details: { reason } })
  await applyUiLanguage('en')
  expect(toErrorMessage(error)).toBe(english)
  expect(toCanvasErrorMessage(error)).toBe(english)
  await applyUiLanguage('zh-CN')
  expect(toErrorMessage(error)).toBe(chinese)
  expect(toCanvasErrorMessage(error)).toBe(chinese)
})
