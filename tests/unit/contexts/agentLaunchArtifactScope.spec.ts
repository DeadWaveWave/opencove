import { describe, expect, it, vi } from 'vitest'
import {
  AgentLaunchArtifactDisposalError,
  AgentLaunchArtifactScope,
} from '../../../src/contexts/agent/application/services/AgentLaunchArtifactScope'

describe('AgentLaunchArtifactScope', () => {
  it('disposes tracked launch artifacts once in reverse registration order', async () => {
    const order: string[] = []
    const first = { dispose: vi.fn(async () => void order.push('first')) }
    const second = { dispose: vi.fn(async () => void order.push('second')) }
    const scope = new AgentLaunchArtifactScope()

    expect(scope.track('first', first)).toBe(first)
    expect(scope.track('second', second)).toBe(second)
    scope.seal()

    await Promise.all([scope.dispose(), scope.dispose()])
    await scope.dispose()

    expect(order).toEqual(['second', 'first'])
    expect(first.dispose).toHaveBeenCalledTimes(1)
    expect(second.dispose).toHaveBeenCalledTimes(1)
    expect(scope.isDisposed).toBe(true)
  })

  it('reports every failed disposal without hiding its artifact label', async () => {
    const firstError = new Error('first cleanup failed')
    const secondError = new Error('second cleanup failed')
    const scope = new AgentLaunchArtifactScope()
    scope.track('first', { dispose: async () => await Promise.reject(firstError) })
    scope.track('second', { dispose: async () => await Promise.reject(secondError) })

    const error = await scope.dispose().catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(AgentLaunchArtifactDisposalError)
    expect((error as AgentLaunchArtifactDisposalError).failures).toEqual([
      { label: 'second', error: secondError },
      { label: 'first', error: firstError },
    ])
  })

  it('rejects invalid or late registrations', () => {
    const scope = new AgentLaunchArtifactScope()
    const artifact = { dispose: async () => undefined }

    expect(() => scope.track(' ', artifact)).toThrow('label cannot be empty')
    scope.track('artifact', artifact)
    expect(() => scope.track('duplicate', artifact)).toThrow('already tracked')
    scope.seal()
    expect(() => scope.track('late', { dispose: async () => undefined })).toThrow('already sealed')
  })
})
