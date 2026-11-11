import { afterEach, expect, it, vi } from 'vitest'
import { useAppStore } from '../../../src/app/renderer/shell/store/useAppStore'
import { negotiateManagedClaudeWorkerSupport } from '../../../src/contexts/workspace/presentation/renderer/utils/managedClaudeWorkerSupport'
import {
  clearWorkerConnectionFailure,
  reportWorkerConnectionFailure,
} from '../../../src/app/renderer/shell/hooks/workerSync/workerConnectionState'

const initial = useAppStore.getState(),
  api = window.opencoveApi
afterEach(() => {
  useAppStore.setState(initial, true)
  window.opencoveApi = api
})
function worker(writes?: boolean, delivery = true) {
  window.opencoveApi = {
    persistence: {},
    controlSurface: {
      invoke: vi.fn(async () => ({
        features: {
          managedClaudeResumeBindingV1: false,
          managedClaudeResumeBindingDeliveryV1: delivery,
          managedClaudeResumeBindingWritesEnabled: writes,
        },
      })),
    },
  } as unknown as typeof api
}
it('warns without blocking a compatible frozen Worker and survives reconnect', async () => {
  worker(false)
  expect(await negotiateManagedClaudeWorkerSupport('required')).toBe(true)
  expect(useAppStore.getState().persistNotice).toMatchObject({
    kind: 'compatibility',
    message: expect.stringContaining('paused'),
  })
  reportWorkerConnectionFailure(new Error('offline'))
  clearWorkerConnectionFailure()
  expect(useAppStore.getState().persistNotice?.kind).toBe('compatibility')
  expect(useAppStore.getState().workerConnectionError).toBeNull()
})
it('does not publish a notice after the persistence scope changes across await', async () => {
  worker(false)
  let resolve!: (value: unknown) => void
  vi.mocked(window.opencoveApi.controlSurface.invoke).mockImplementationOnce(
    () =>
      new Promise(done => {
        resolve = done
      }) as never,
  )
  const pending = negotiateManagedClaudeWorkerSupport('required')
  worker(true)
  resolve({
    features: {
      managedClaudeResumeBindingDeliveryV1: true,
      managedClaudeResumeBindingWritesEnabled: false,
    },
  })
  await pending
  expect(useAppStore.getState().persistNotice).toBeNull()
})
it('does not treat a reused PR3b Worker with unknown writes permission as frozen', async () => {
  worker(undefined)
  expect(await negotiateManagedClaudeWorkerSupport('required')).toBe(true)
  expect(useAppStore.getState().persistNotice).toBeNull()
})
it('clears the current compatibility reason only on confirmed enabled writes', async () => {
  worker(false)
  await negotiateManagedClaudeWorkerSupport('required')
  vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValue({
    features: { managedClaudeResumeBindingDeliveryV1: true },
  })
  await negotiateManagedClaudeWorkerSupport('required')
  expect(useAppStore.getState().persistNotice?.kind).toBe('compatibility')
  vi.mocked(window.opencoveApi.controlSurface.invoke).mockResolvedValue({
    features: {
      managedClaudeResumeBindingDeliveryV1: true,
      managedClaudeResumeBindingWritesEnabled: true,
    },
  })
  await negotiateManagedClaudeWorkerSupport('required')
  expect(useAppStore.getState().persistNotice).toBeNull()
})

it.each(['write', 'connection', 'recovery'] as const)(
  'retains a higher-priority %s notice',
  async kind => {
    worker(false)
    const covered = { kind, tone: 'error' as const, message: 'Higher priority' }
    useAppStore.getState().setPersistNotice(covered)
    await negotiateManagedClaudeWorkerSupport('required')
    expect(useAppStore.getState().persistNotice).toEqual(covered)
  },
)
it('expires the old scope reason without calling an unknown older Worker frozen', async () => {
  worker(false)
  await negotiateManagedClaudeWorkerSupport('required')
  worker(undefined)
  await negotiateManagedClaudeWorkerSupport('required')
  expect(useAppStore.getState().persistNotice).toBeNull()
})
