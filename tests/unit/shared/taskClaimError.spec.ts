import { expect, it } from 'vitest'
import { formatAppErrorMessage } from '../../../src/shared/errors/appError'
import { taskClaimErrorPresentation } from '../../../src/shared/errors/taskClaimError'
import { toRendererAppErrorDescriptor } from '../../../src/shared/errors/rendererAppError'
import { enMessages } from '../../../src/app/renderer/i18n/locales/en.messages'
import { zhCNMessages } from '../../../src/app/renderer/i18n/locales/zh-CN.messages'

it('preserves bounded public holder details and explains the refusal in both languages', () => {
  const descriptor = {
    code: 'task.already_claimed' as const,
    details: {
      taskNodeId: 'task',
      holder: { nodeId: 'agent', title: 'Reviewer', secret: 'hidden' },
      secret: 'hidden',
    },
  }
  const projected = toRendererAppErrorDescriptor(descriptor)!
  expect(projected).toEqual({
    code: descriptor.code,
    details: { taskNodeId: 'task', holder: { nodeId: 'agent', title: 'Reviewer' } },
  })
  expect(taskClaimErrorPresentation(projected)).toMatchObject({
    holder: 'Reviewer',
    hint: expect.stringContaining('release'),
  })
  expect(formatAppErrorMessage(projected)).toContain('Reviewer')
  expect(enMessages.taskAlreadyClaimed).toContain('{{holder}}')
  expect(zhCNMessages.taskAlreadyClaimed).toContain('{{holder}}')
})

it.each(['agent_identity_mismatch', 'not_current_holder'])(
  'keeps task access refusals public and localized: %s',
  reason => {
    const projected = toRendererAppErrorDescriptor({
      code: 'common.forbidden',
      details: { reason, secret: 'hidden' },
    })!
    expect(projected).toEqual({ code: 'common.forbidden', details: { reason } })
    expect(formatAppErrorMessage(projected)).toContain('your own agents or agents you started')
    expect(enMessages.taskAgentAccess).toContain('agents you started')
    expect(zhCNMessages.taskAgentAccess).toContain('由你启动')
  },
)
