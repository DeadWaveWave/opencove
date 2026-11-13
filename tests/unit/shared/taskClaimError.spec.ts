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
