import { describe, expect, it } from 'vitest'
import { getAppErrorDebugMessage, OpenCoveAppError } from '../../../src/shared/errors/appError'

describe('workspace path opener validation', () => {
  it('accepts the supported opener ids and absolute path formats', async () => {
    const { normalizeOpenWorkspacePathPayload } =
      await import('../../../src/contexts/workspace/presentation/main-ipc/validate')

    expect(
      normalizeOpenWorkspacePathPayload({
        path: '/tmp/cove-approved-workspace/project',
        openerId: 'android-studio',
      }),
    ).toEqual({
      path: '/tmp/cove-approved-workspace/project',
      openerId: 'android-studio',
    })

    expect(
      normalizeOpenWorkspacePathPayload({
        path: 'C:\\Users\\deadwave\\project',
        openerId: 'terminal',
      }),
    ).toEqual({
      path: 'C:\\Users\\deadwave\\project',
      openerId: 'terminal',
    })

    try {
      normalizeOpenWorkspacePathPayload({
        path: '/tmp/cove-approved-workspace/project',
        openerId: 'unknown-app',
      })
      throw new Error('Expected normalizeOpenWorkspacePathPayload to throw')
    } catch (error) {
      expect(error).toBeInstanceOf(OpenCoveAppError)
      expect((error as OpenCoveAppError).code).toBe('common.invalid_input')
      expect((error as OpenCoveAppError).message).toBe('The request was invalid.')
      expect(getAppErrorDebugMessage(error)).toBe('Invalid openerId for workspace:open-path')
    }
  })
})
