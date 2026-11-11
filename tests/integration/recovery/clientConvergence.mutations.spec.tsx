/* eslint-disable no-await-in-loop -- Mutations replay an ordered protocol trace. */
import { afterEach, expect, it, vi } from 'vitest'
import { Client } from '../../support/convergence/client'
import { markPersistedStateAsSynced } from '@contexts/workspace/presentation/renderer/utils/persistence/write'
import * as publication from '@contexts/workspace/presentation/renderer/utils/persistence/publicationState'
import { useAppStore } from '@app/renderer/shell/store/useAppStore'
import { value } from '../../support/convergence/fixture'
import { checkLegacyCompatibility } from '../../support/convergence/legacy'
import { explore } from '../../support/convergence/model'
import { legacyBaseline } from '../../support/convergence/legacyBaseline'
let c: Client | undefined
afterEach(async () => {
  await c?.close()
  c = undefined
  vi.restoreAllMocks()
})
it.each([1, 2, 3, 4, 5, 6, 7])('kills the I%i boundary mutation', async invariant => {
  c = new Client(invariant === 5, 'local', 'committed')
  if (invariant === 1) {
    c.server.model.edit('name', 'lost')
    expect(() => c!.check(false)).toThrow('I1')
  }
  if (invariant === 2) {
    const falseAck = c.state()
    falseAck.workspaces[0].name = 'never committed'
    markPersistedStateAsSynced(falseAck, 2)
    expect(() => c!.check(false)).toThrow('I2')
  }
  if (invariant === 3) {
    c.server.model.unknown = true
    c.server.model.thirdParty()
    c.server.model.commit({ ...c.server.model.value, name: 'blind replay' })
    expect(() => c!.check(false)).toThrow('I3')
  }
  if (invariant === 4) {
    useAppStore.getState().setWorkspaces(ws => ws.map(w => ({ ...w, name: 'stale UI' })))
    expect(() => c!.check(true)).toThrow('I4')
  }
  if (invariant === 5) {
    useAppStore.getState().setWorkspaces(ws =>
      ws.map(w => ({
        ...w,
        nodes: w.nodes.map(n =>
          n.id === 'agent'
            ? { ...n, data: { ...n.data, agent: { ...n.data.agent!, resumeSessionId: 'stale' } } }
            : n,
        ),
      })),
    )
    expect(() => c!.check(false)).toThrow('I5')
  }
  if (invariant === 6) {
    const original = publication.canAcceptCanonicalState
    vi.spyOn(publication, 'canAcceptCanonicalState').mockImplementation(
      (state, revision) => state.workspaces[0].viewport.x !== 999 && original(state, revision),
    )
    expect(() => c!.check(false)).toThrow('I6')
  }
  if (invariant === 7) {
    const baseline = legacyBaseline.find(row => row.adapter === 'local' && row.index === 3)!
    for (const action of explore()[3].actions) {
      await c.step(action)
    }
    await c.quiet()
    checkLegacyCompatibility(baseline, { ui: value(c.state()), server: c.server.model.value })
    useAppStore.getState().setWorkspaces(ws => ws.map(w => ({ ...w, name: 'legacy regression' })))
    expect(() =>
      checkLegacyCompatibility(baseline, { ui: value(c!.state()), server: c!.server.model.value }),
    ).toThrow('I7')
  }
})
