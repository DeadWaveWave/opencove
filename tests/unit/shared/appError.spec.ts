import { describe, expect, it } from 'vitest'
import {
  createAppError,
  createAppErrorDescriptor,
  formatAppErrorMessage,
  getAppErrorDebugMessage,
  isAppErrorDescriptor,
  isIpcInvokeResult,
  toAppErrorDescriptor,
} from '../../../src/shared/errors/appError'

describe('appError', () => {
  it('formats stable user-facing messages from app error codes', () => {
    expect(formatAppErrorMessage(createAppErrorDescriptor('agent.launch_failed'))).toBe(
      'Unable to start the agent.',
    )
    expect(formatAppErrorMessage(createAppErrorDescriptor('worktree.api_unavailable'))).toBe(
      'Worktree API is unavailable. Please restart OpenCove and try again.',
    )
  })

  it('retains actionable plugin failures through an Error-message-only bridge', () => {
    const descriptor = createAppErrorDescriptor('plugin.operation_failed', {
      params: { reason: 'main.mjs must export activate(context).' },
    })
    expect(createAppError(descriptor).message).toBe(
      'Plugin operation failed. main.mjs must export activate(context).',
    )
    expect(
      formatAppErrorMessage(
        createAppErrorDescriptor('plugin.operation_failed', {
          params: { reason: 'x'.repeat(3000) },
        }),
      ),
    ).toHaveLength('Plugin operation failed. '.length + 2000)
  })

  it('preserves debug detail separately from the user-facing message', () => {
    const error = createAppError('worktree.create_failed', {
      debugMessage: 'git worktree add failed: branch already exists',
    })

    expect(error.message).toBe('Unable to create the worktree.')
    expect(getAppErrorDebugMessage(error)).toBe('git worktree add failed: branch already exists')
  })

  it('wraps unknown errors with a fallback code and debug detail', () => {
    const descriptor = toAppErrorDescriptor(
      new Error('permission denied'),
      'workspace.open_path_failed',
    )

    expect(descriptor.code).toBe('workspace.open_path_failed')
    expect(descriptor.debugMessage).toContain('permission denied')
  })

  it('detects app error descriptors and IPC envelopes without colliding with plain ok results', () => {
    expect(isAppErrorDescriptor(createAppErrorDescriptor('common.invalid_input'))).toBe(true)
    expect(
      isIpcInvokeResult({
        __opencoveIpcEnvelope: true,
        ok: true,
        value: { ok: true, level: 'full', bytes: 12 },
      }),
    ).toBe(true)
    expect(isIpcInvokeResult({ ok: true, level: 'full', bytes: 12 })).toBe(false)
  })
})

it('formats only allowlisted filesystem reasons and ignores arbitrary reason text', () => {
  expect(
    createAppError('filesystem.stat_failed', { params: { reason: 'not_found' } }).message,
  ).toBe('Unable to read file details. The file or folder does not exist.')
  expect(
    createAppError('filesystem.stat_failed', { params: { reason: 'token=secret' } }).message,
  ).toBe('Unable to read file details.')
})
