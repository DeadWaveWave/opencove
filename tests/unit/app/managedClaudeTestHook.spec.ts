// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, expect, it, vi } from 'vitest'
import { tryManagedClaudeTestHook } from '../../../src/app/main/controlSurface/http/managedClaudeTestHook'
import type { PersistenceStore } from '../../../src/platform/persistence/sqlite/PersistenceStore'
afterEach(() => vi.unstubAllEnvs())
function fixture() {
  const req = Object.assign(new EventEmitter(), {
    url: '/_test/managed-claude-rebind',
    method: 'POST',
  }) as IncomingMessage
  const end = vi.fn()
  const res = { setHeader: vi.fn(), end } as unknown as ServerResponse
  const commit = vi.fn(async () => ({ status: 'committed', revision: 8 }))
  const store = {
    observeManagedClaudeNode: () => ({
      binding: {
        runtimeSessionId: 'current',
        tuple: { resumeSessionId: 'A', resumeSessionIdVerified: true },
      },
    }),
    commitManagedClaudeRebind: commit,
  } as unknown as PersistenceStore
  const getStore = vi.fn(async () => store)
  return { req, res, end, getStore, commit }
}
it.each([
  ['production', '1'],
  ['test', '0'],
])('has no product hook in %s with flag %s', async (mode, enabled) => {
  vi.stubEnv('NODE_ENV', mode)
  vi.stubEnv('OPENCOVE_TEST_ENABLE_MANAGED_CLAUDE_REBIND', enabled)
  const f = fixture()
  expect(await tryManagedClaudeTestHook({ ...f, privateBearer: true })).toBe(false)
  expect(f.getStore).not.toHaveBeenCalled()
})
it('requires private bearer and uses the current store contract', async () => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('OPENCOVE_TEST_ENABLE_MANAGED_CLAUDE_REBIND', '1')
  const f = fixture()
  expect(await tryManagedClaudeTestHook({ ...f, privateBearer: false })).toBe(true)
  expect(f.res.statusCode).toBe(403)
  expect(f.getStore).not.toHaveBeenCalled()
  const pending = tryManagedClaudeTestHook({ ...f, privateBearer: true })
  f.req.emit(
    'data',
    JSON.stringify({ nodeId: 'node', resumeSessionId: '00000000-0000-4000-8000-000000000001' }),
  )
  f.req.emit('end')
  expect(await pending).toBe(true)
  expect(f.commit).toHaveBeenCalledWith(
    expect.objectContaining({
      nodeId: 'node',
      runtimeSessionId: 'current',
      expected: { resumeSessionId: 'A', resumeSessionIdVerified: true },
    }),
  )
  expect(f.end).toHaveBeenLastCalledWith(expect.stringContaining('"revision":8'))
})

it('rechecks the freeze after deferred store acquisition before committing a rebind', async () => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('OPENCOVE_TEST_ENABLE_MANAGED_CLAUDE_REBIND', '1')
  vi.stubEnv('OPENCOVE_MANAGED_CLAUDE_BINDINGS', '1')
  const f = fixture()
  let release!: () => void
  const barrier = new Promise<void>(resolve => {
    release = resolve
  })
  const originalGet = f.getStore.getMockImplementation()!
  f.getStore.mockImplementation(async () => {
    await barrier
    return originalGet()
  })
  const pending = tryManagedClaudeTestHook({ ...f, privateBearer: true })
  f.req.emit(
    'data',
    JSON.stringify({ nodeId: 'node', resumeSessionId: '00000000-0000-4000-8000-000000000001' }),
  )
  f.req.emit('end')
  await vi.waitFor(() => expect(f.getStore).toHaveBeenCalledOnce())
  vi.stubEnv('OPENCOVE_MANAGED_CLAUDE_BINDINGS', '0')
  release()
  expect(await pending).toBe(true)
  expect(f.commit).not.toHaveBeenCalled()
  expect(f.end).toHaveBeenCalledWith(expect.stringContaining('writesDisabled'))
})
