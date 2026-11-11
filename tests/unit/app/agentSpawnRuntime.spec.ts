// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { createAgentSpawnRuntime } from '../../../src/app/main/controlSurface/agentSpawnRuntime'
import { canvasSpawnIdentity } from '../../../src/app/main/controlSurface/sessionSpawnIdentityContext'
import { physicalSpawnLifecycle } from '../../../src/shared/runtime/physicalSpawnLifecycle'
import type { ControlSurfacePtyRuntime } from '../../../src/app/main/controlSurface/handlers/sessionPtyRuntime'
import { createHeadlessPtyRuntime } from '../../../src/app/worker/headlessPtyRuntime'
import { FakeTerminalProcessEngine } from '../../support/FakeTerminalProcessEngine'
const identity = { projectId: 'p', spaceId: 's', nodeId: 'child' }
const input = { command: 'fixture', args: [], cwd: '/tmp', cols: 80, rows: 24 }
function fixture(spawn: ControlSurfacePtyRuntime['spawnSession']) {
  const exits = new Set<(e: { sessionId: string; exitCode: number }) => void>()
  const kill = vi.fn()
  const adapter = createAgentSpawnRuntime({
    spawnSession: spawn,
    kill,
    write: () => {},
    resize: async () => ({ status: 'session_not_found' }) as never,
    onData: () => () => {},
    onExit: listener => {
      exits.add(listener)
      return () => {
        exits.delete(listener)
      }
    },
  })
  return {
    ...adapter,
    kill,
    exit: (id: string) => exits.forEach(fn => fn({ sessionId: id, exitCode: 0 })),
  }
}
it('keeps occupancy after kill request, releases duplicate exits idempotently, and separates incarnations', async () => {
  let id = 0
  const f = fixture(async () => ({ sessionId: 's' + id++ }))
  await canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input))
  await canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input))
  f.runtime.kill('s0')
  expect(f.port.snapshot().bindings).toHaveLength(2)
  f.exit('s0')
  f.exit('s0')
  expect(f.port.snapshot().bindings.map(b => b.sessionId)).toEqual(['s1'])
  f.exit('s1')
  expect(f.port.snapshot().bindings).toEqual([])
  f.dispose()
})
it('does not reinstall a runtime that exits before its spawn result registers', async () => {
  let release!: (v: { sessionId: string }) => void
  const f = fixture(
    () =>
      new Promise(resolve => {
        release = resolve
      }),
  )
  const spawn = canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input))
  f.exit('early')
  release({ sessionId: 'early' })
  await spawn
  expect(f.port.snapshot().bindings).toEqual([])
  f.dispose()
})
it('captures engine identity before a throwing headless metadata callback and cleans the exact session', async () => {
  const engine = new FakeTerminalProcessEngine()
  engine.spawn.mockResolvedValue({ sessionId: 'physical' })
  const runtime = createHeadlessPtyRuntime({ processEngine: engine })
  runtime.onMetadata(() => {
    throw new Error('metadata failed')
  })
  const f = createAgentSpawnRuntime(runtime)
  await expect(
    canvasSpawnIdentity.run(identity, () =>
      f.runtime.spawnSession({ ...input, agentProvider: 'claude-code' }),
    ),
  ).rejects.toThrow('metadata failed')
  expect(engine.kill).toHaveBeenCalledWith('physical')
  expect(f.port.snapshot().bindings).toMatchObject([{ nodeId: 'child', sessionId: 'physical' }])
  engine.emitExit({ sessionId: 'physical', exitCode: 0 })
  expect(f.port.snapshot().bindings).toEqual([])
  f.dispose()
  await runtime.dispose()
})
it('keeps unknown dispatch occupancy until authoritative host completion', async () => {
  let done!: () => void
  const completion = new Promise<void>(resolve => {
    done = resolve
  })
  const f = fixture(async () => {
    physicalSpawnLifecycle.getStore()!.unknown(completion)
    throw new Error('response lost')
  })
  await expect(
    canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input)),
  ).rejects.toThrow('response lost')
  expect(f.port.snapshot().bindings).toMatchObject([{ state: 'unknown' }])
  done()
  await completion
  await Promise.resolve()
  expect(f.port.snapshot().bindings).toEqual([])
  f.dispose()
})
it('creates no occupancy for a known pre-start failure', async () => {
  const f = fixture(async () => {
    throw new Error('not started')
  })
  await expect(
    canvasSpawnIdentity.run(identity, () => f.runtime.spawnSession(input)),
  ).rejects.toThrow()
  expect(f.port.snapshot().bindings).toEqual([])
  f.dispose()
})
