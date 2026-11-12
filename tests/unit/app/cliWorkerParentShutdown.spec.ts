import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import {
  createWorkerParentShutdown,
  WORKER_PARENT_SHUTDOWN,
} from '../../../src/shared/runtime/workerParentShutdown'
it.each(['message', 'disconnect'])(
  'queues early %s shutdown until the owner is ready and deduplicates it',
  event => {
    const parent = Object.assign(new EventEmitter(), { send: vi.fn() })
    const control = createWorkerParentShutdown(parent as unknown as NodeJS.Process)
    const shutdown = vi.fn()
    parent.emit('message', { type: 'unknown' })
    expect(shutdown).not.toHaveBeenCalled()
    parent.emit(event, { type: WORKER_PARENT_SHUTDOWN })
    control.activate(shutdown)
    expect(shutdown).toHaveBeenCalledOnce()
    parent.emit('message', { type: WORKER_PARENT_SHUTDOWN })
    parent.emit('disconnect')
    expect(shutdown).toHaveBeenCalledOnce()
    control.dispose()
    expect(parent.listenerCount('message')).toBe(0)
    expect(parent.listenerCount('disconnect')).toBe(0)
  },
)
