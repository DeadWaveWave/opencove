// @vitest-environment node
import { expect, it } from 'vitest'
import { createAppError, formatAppErrorMessage } from '../../../src/shared/errors/appError'
import { publicTerminalSpawnError } from '../../../src/shared/errors/terminalSpawnError'
import { createTerminalSpawnApplicationError } from '../../../src/shared/errors/terminalSpawnError'
import { SessionRegistrationRejectedError } from '../../../src/shared/runtime/sessionRegistrationOwner'

const guidance = 'To create this terminal, connect to a Worker running inside WSL.'
const secret = 'private-spawn-environment-value'
const safe = {
  code: 'common.unavailable',
  details: { reason: 'native_wsl_worker_required' },
  debugMessage: guidance,
}

it('uses the same safe reason text for application errors and shared caller rendering', () => {
  const input = {
    code: 'common.unavailable' as const,
    details: { reason: 'native_wsl_worker_required' },
    debugMessage: secret,
  }
  expect(createAppError(input).message).toBe(guidance)
  expect(formatAppErrorMessage(input)).toBe(guidance)
  expect(formatAppErrorMessage({ ...input, details: { reason: 'unknown' } })).toBe(
    'This feature is unavailable.',
  )
})

it.each(['application-error', 'serialized-descriptor'] as const)(
  'reconstructs the typed safe reason from %s without retaining private fields',
  form => {
    const descriptor = {
      code: 'common.unavailable' as const,
      details: { reason: 'native_wsl_worker_required', env: secret },
      params: { secret },
      debugMessage: secret,
    }
    const input =
      form === 'application-error'
        ? createAppError(descriptor)
        : JSON.parse(JSON.stringify(descriptor))
    const output = publicTerminalSpawnError(input, 'terminal.spawn_failed')
    expect(output.toDescriptor()).toEqual(safe)
    expect(JSON.stringify(output.toDescriptor())).not.toContain(secret)
    expect(
      publicTerminalSpawnError(
        JSON.parse(JSON.stringify(output.toDescriptor())),
        'agent.launch_failed',
      ).toDescriptor(),
    ).toEqual(safe)
  },
)

it.each([
  new Error(secret),
  secret,
  createAppError('common.unavailable', {
    debugMessage: secret,
    details: { reason: 'unknown', env: secret },
  }),
  createAppError('agent.launch_failed', {
    debugMessage: secret,
    details: { reason: 'native_wsl_worker_required', env: secret },
  }),
  {
    code: 'common.unavailable',
    details: { reason: '__proto__', env: secret },
    debugMessage: secret,
  },
])('suppresses arbitrary spawn error payload %#', error => {
  const descriptor = publicTerminalSpawnError(error, 'terminal.spawn_failed').toDescriptor()
  expect(descriptor.debugMessage).toBeUndefined()
  expect(descriptor.details).toBeUndefined()
  expect(descriptor.params).toBeUndefined()
  expect(JSON.stringify(descriptor)).not.toContain(secret)
})

it.each(['completed', 'owner_disposed'] as const)(
  'retains fixed %s lifecycle text without session data',
  disposition => {
    const descriptor = publicTerminalSpawnError(
      new SessionRegistrationRejectedError(secret, disposition),
      'agent.launch_failed',
    ).toDescriptor()
    expect(descriptor.debugMessage).toContain('before spawn registration')
    expect(JSON.stringify(descriptor)).not.toContain(secret)
  },
)

it('retains the typed input-file application refusal across a wire round trip', () => {
  const error = createTerminalSpawnApplicationError('wsl_input_file_unavailable')
  const descriptor = publicTerminalSpawnError(
    JSON.parse(JSON.stringify(error.toDescriptor())),
    'agent.launch_failed',
  ).toDescriptor()
  expect(descriptor).toMatchObject({
    code: 'common.unavailable',
    details: { reason: 'wsl_input_file_unavailable' },
    debugMessage: expect.stringContaining('Choose a profile that can access the file'),
  })
})
