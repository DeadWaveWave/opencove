import { afterEach, expect, it, vi } from 'vitest'
import { continuationFixture as fixture, enqueue } from './claudeTurnContinuation.helpers'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})
it('continuation diagnostics are silent unless explicitly enabled', () => {
  vi.stubEnv('OPENCOVE_DEBUG_AGENT_CONTINUATION', '0')
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const f = fixture()
  f.hook('UserPromptSubmit', 'A')
  f.record(enqueue)
  f.hook('Stop', 'A', 'private reply')
  expect(write).not.toHaveBeenCalled()
  f.runtime.dispose()
})
it('continuation diagnostics include decisions, bounded identifiers, counts and timings without content', () => {
  vi.stubEnv('OPENCOVE_DEBUG_AGENT_CONTINUATION', '1')
  const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  const f = fixture()
  f.hook('UserPromptSubmit', 'long-provider-prompt-A')
  f.record(enqueue)
  f.hook('Stop', 'long-provider-prompt-A', 'private final reply')
  f.hook('Stop', 'long-provider-prompt-B', 'another private reply')
  f.tick(5001)
  f.record({ kind: 'user', promptId: 'long-provider-prompt-B', promptSource: 'queued' })
  f.record({
    kind: 'checkpoint',
    promptId: 'long-provider-prompt-B',
    queueEmpty: true,
    final: true,
  })
  const output = write.mock.calls.map(args => args[0]).join('')
  expect(output).toContain('provider_end_decision')
  expect(output).toContain('readiness_recovered')
  expect(output).toContain('"elapsedMs":')
  expect(output).toContain('"pending":')
  expect(output).not.toContain('private final reply')
  expect(output).not.toContain('another private reply')
  expect(output).not.toContain('long-provider-prompt-A')
  expect(output).not.toContain('long-provider-prompt-B')
  f.runtime.dispose()
})
