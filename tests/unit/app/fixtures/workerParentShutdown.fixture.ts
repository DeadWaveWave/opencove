import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createWorkerParentShutdown } from '../../../../src/shared/runtime/workerParentShutdown'
import { createWorkerShutdown } from '../../../../src/app/worker/workerShutdown'
import { acquireWorkerSingleInstanceLock } from '../../../../src/app/worker/singleInstanceLock'
import { ControlSurfaceAcceptedRequestOwner } from '../../../../src/app/main/controlSurface/controlSurfaceAcceptedRequestOwner'

const channel = createWorkerParentShutdown()
const root = process.argv[2]
const lock = await acquireWorkerSingleInstanceLock(root)
if (lock.status !== 'acquired') {
  throw Error('Fixture lock unavailable')
}
const requests = new ControlSurfaceAcceptedRequestOwner()
requests.track(
  new Promise<void>(resolve => {
    process.on('message', message => {
      if (message === 'complete-work') {
        void writeFile(join(root, 'completed'), 'durable result').then(() => resolve())
      }
    })
  }),
)
const shutdown = createWorkerShutdown(() => requests.sealAndDrain(), lock.release)
channel.activate(() => {
  process.send?.('draining')
  void shutdown(0)
})
process.send?.('ready')
