import { describe, expect, it } from 'vitest'
import { OpenCoveAppError } from '../../../src/shared/errors/appError'
import {
  reviveRendererAppError,
  toRendererAppErrorDescriptor,
} from '../../../src/shared/errors/rendererAppError'
import { persistenceWriteFailure } from '../../../src/shared/sync/persistenceWriteOutcome'

describe('public renderer errors', () => {
  it('revives safe application semantics across every code', () => {
    const error = reviveRendererAppError({
      code: 'agent.launch_failed',
      details: {
        managedClaudeLaunch: true,
        phase: 'afterSpawn',
        secret: 'SECRET',
      },
      debugMessage: 'SECRET',
      params: { token: 'SECRET' },
    })
    expect(error).toBeInstanceOf(OpenCoveAppError)
    expect(error).toBeInstanceOf(Error)
    expect((error as OpenCoveAppError).details).toEqual({
      managedClaudeLaunch: true,
      phase: 'afterSpawn',
    })
    expect(JSON.stringify(error)).not.toContain('SECRET')
  })
  it.each([
    null,
    {},
    { code: 'toString' },
    Object.create({ code: 'common.invalid_input' }),
    { code: 'future.error' },
  ])('keeps invalid metadata uncertain: %j', value => {
    const error = reviveRendererAppError(value)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(OpenCoveAppError)
    expect(persistenceWriteFailure(error).outcome).toBe('unknown')
  })
  it('does not invoke getters or walk cycles', () => {
    const input = {
      code: 'common.invalid_input',
      get details() {
        throw Error('SECRET')
      },
    }
    expect(toRendererAppErrorDescriptor(input)).toEqual({ code: 'common.invalid_input' })
    const details: Record<string, unknown> = {}
    details.self = details
    expect(toRendererAppErrorDescriptor({ code: 'common.invalid_input', details })).toEqual({
      code: 'common.invalid_input',
    })
  })
  it('recognizes only the exact legacy revision diagnostic', () => {
    expect(
      toRendererAppErrorDescriptor({
        code: 'persistence.invalid_state',
        debugMessage: 'sync.writeState revision conflict (base=12, current=13)',
      })?.details,
    ).toEqual({ reason: 'revisionConflict' })
    expect(
      toRendererAppErrorDescriptor({
        code: 'persistence.invalid_state',
        debugMessage: 'SECRET revision conflict',
      })?.details,
    ).toBeUndefined()
  })
  it.each(['common.unexpected', 'agent.managed_launch_commit_failed'] as const)(
    'does not infer rejection from application identity alone: %s',
    code => {
      expect(persistenceWriteFailure(reviveRendererAppError({ code })).outcome).toBe('unknown')
    },
  )
  it('keeps resolved rejection semantics distinct from transport uncertainty', () => {
    expect(
      persistenceWriteFailure(reviveRendererAppError({ code: 'persistence.invalid_state' }))
        .outcome,
    ).toBe('rejected')
  })
})
