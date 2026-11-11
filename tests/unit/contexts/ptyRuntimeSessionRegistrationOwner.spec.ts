// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { PtyRuntimeSessionRegistrationOwner } from '../../../src/contexts/terminal/presentation/main-ipc/sessionRegistrationOwner'
import { physicalSpawnLifecycle } from '../../../src/shared/runtime/physicalSpawnLifecycle'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'

it('delivers exact completion even when desktop registration throws before public exit listeners', async () => {
  const engine = new FakeTerminalProcessEngine()
  engine.spawn.mockResolvedValue({ sessionId: 'physical' })
  const owner = new PtyRuntimeSessionRegistrationOwner({
    processEngine: engine,
    register: () => {
      throw new Error('desktop callback failed')
    },
  })
  const observer = {
    beforeDispatch: () => {},
    started: vi.fn(),
    completed: vi.fn(),
    unknown: () => {},
  }
  await expect(
    physicalSpawnLifecycle.run(observer, () =>
      owner.spawn({ command: 'fixture', args: [], cwd: '/repo', cols: 80, rows: 24 }),
    ),
  ).rejects.toThrow('desktop callback failed')
  expect(observer.started).toHaveBeenCalledWith('physical')
  // noteExit is invoked before desktop manager callbacks, independently of their success.
  owner.noteExit('physical')
  owner.noteExit('physical')
  expect(observer.completed).toHaveBeenCalledExactlyOnceWith('physical')
  owner.dispose()
})
