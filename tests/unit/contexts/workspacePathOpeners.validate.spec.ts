import { describe, expect, it } from 'vitest'

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

    expect(() =>
      normalizeOpenWorkspacePathPayload({
        path: '/tmp/cove-approved-workspace/project',
        openerId: 'unknown-app',
      }),
    ).toThrow(/Invalid openerId/)
  })
})
