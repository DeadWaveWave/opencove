// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createControlSurfaceHttpRuntime } from '../../../src/app/main/controlSurface/controlSurfaceHttpRuntime'
import { ManagedClaudeRebindState } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeRebindState'
import { ManagedClaudeLaunchOwner } from '../../../src/contexts/agent/application/managedClaudeLaunch/ManagedClaudeLaunchOwner'
import { createApprovedWorkspaceStoreForPath } from '../../../src/contexts/workspace/infrastructure/approval/ApprovedWorkspaceStoreCore'
import { createInMemoryPersistenceStore } from '../../contract/controlSurface/controlSurfaceHttpServer.sessionStreaming.testUtils'

it('starts managed drain before disposal and retains persistence until admitted work settles', async () => {
  const root = await mkdtemp(join(tmpdir(), 'opencove-clear-shutdown-'))
  let release!: () => void
  const held = new Promise<void>(resolve => {
    release = resolve
  })
  const order: string[] = []
  const drain = vi
    .spyOn(ManagedClaudeRebindState.prototype, 'drain')
    .mockImplementation(async () => {
      order.push('drain')
      await held
      order.push('settled')
      return { status: 'drained' }
    })
  const disposeOwner = vi.spyOn(ManagedClaudeLaunchOwner.prototype, 'dispose')
  const store = createInMemoryPersistenceStore(),
    disposeStore = vi.spyOn(store, 'dispose')
  const runtime = createControlSurfaceHttpRuntime({
    userDataPath: root,
    token: 'test',
    approvedWorkspaces: createApprovedWorkspaceStoreForPath(join(root, 'approved.json')),
    createPersistenceStore: async () => store,
    ptyRuntime: {
      spawnSession: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
      onData: () => () => {},
      onExit: () => () => {},
    },
  })
  try {
    await runtime.ready
    runtime.beginShutdown()
    await vi.waitFor(() => expect(drain).toHaveBeenCalledOnce())
    const done = runtime.dispose()
    expect(disposeOwner).not.toHaveBeenCalled()
    expect(disposeStore).not.toHaveBeenCalled()
    release()
    await done
    expect(order).toEqual(['drain', 'settled'])
    expect(disposeOwner).toHaveBeenCalledOnce()
    expect(disposeStore).toHaveBeenCalledOnce()
  } finally {
    release()
    await runtime.dispose()
    vi.restoreAllMocks()
    await rm(root, { recursive: true, force: true })
  }
})
