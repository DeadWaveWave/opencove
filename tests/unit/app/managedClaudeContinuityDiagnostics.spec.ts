import { afterEach, expect, it, vi } from 'vitest'
import type { Page } from '@playwright/test'
import * as diagnostics from '../../e2e/managedClaudeContinuityDiagnostics'
import type { ContinuityWrite } from '../../e2e/managedClaudeContinuityDiagnostics'

const originalApi = Object.getOwnPropertyDescriptor(window, 'opencoveApi')
const originalPosition = { x: 0, y: 0 }
const submittedPosition = { x: 120, y: 80 }
const expectedTuple = { resumeSessionId: 'B', resumeSessionIdVerified: true }
const page = {
  evaluate: async (script: (arg: unknown) => unknown, arg: unknown) =>
    structuredClone(await script(arg)),
} as unknown as Page

afterEach(() => {
  if (originalApi) {
    Object.defineProperty(window, 'opencoveApi', originalApi)
  } else {
    Reflect.deleteProperty(window, 'opencoveApi')
  }
  Reflect.deleteProperty(window, '__managedContinuity')
})

function setup(overrides: Partial<ContinuityWrite> = {}) {
  const write: ContinuityWrite = {
    seq: 4,
    route: 'structured',
    candidate: { resumeSessionId: 'A', verified: true, position: submittedPosition },
    carried: 'A',
    baseRevision: 2,
    ok: true,
    corrected: true,
    merged: true,
    revision: 5,
    ...overrides,
  }
  window.__managedContinuity = {
    nodeId: 'agent',
    a: 'A',
    b: 'B',
    seq: 6,
    reads: [],
    writes: [write],
  }
  let canonical = {
    revision: 5,
    recovery: null,
    state: {
      workspaces: [
        {
          nodes: [
            { id: 'other', agent: expectedTuple, position: submittedPosition },
            { id: 'agent', agent: { ...expectedTuple }, position: { ...submittedPosition } },
          ],
        },
      ],
    },
  }
  const read = vi.fn(async () => structuredClone(canonical))
  window.opencoveApi = {
    persistence: { readAppState: read },
  } as unknown as typeof window.opencoveApi
  return {
    write,
    read,
    setCanonical: (changes: Partial<typeof canonical>) => {
      canonical = { ...canonical, ...changes }
    },
    node: canonical.state.workspaces[0].nodes[1],
  }
}

const waitForWrite = () =>
  diagnostics.waitForManagedLayoutWrite(page, {
    afterSeq: 3,
    before: originalPosition,
    stale: true,
    timeout: 20,
  })

it.each(['corrected', 'merged'] as const)(
  'returns the matching confirmed %s write and proves its layout with verified canonical B',
  async kind => {
    const t = setup({ corrected: kind === 'corrected', merged: kind === 'merged' })
    const write = await waitForWrite()
    expect(write).toEqual(t.write)
    await diagnostics.waitForManagedCanonicalLayout(page, 'agent', write, expectedTuple, 100)
    expect(t.read).toHaveBeenCalled()
  },
)

it('rejects canonical B at the original position even when another node retains the drag', async () => {
  const t = setup()
  t.node.position = originalPosition
  const proof = async () => {
    const write = await waitForWrite()
    await diagnostics.waitForManagedCanonicalLayout(page, 'agent', write, expectedTuple, 20)
  }
  await expect(proof()).rejects.toThrow(/canonical snapshot[\s\S]*"x":0,"y":0/)
})

it.each([null, -1, 1.5, Infinity, NaN])(
  'rejects a merged receipt without a valid commit revision (%s)',
  async revision => {
    setup({ corrected: false, revision })
    await expect(waitForWrite()).rejects.toThrow(/confirmed commit revision[\s\S]*"writes"/)
  },
)

it('rejects an explicitly uncertain merged receipt even if it includes a revision', async () => {
  setup({ corrected: false, uncertain: true })
  await expect(waitForWrite()).rejects.toThrow(/confirmed commit revision[\s\S]*"uncertain":true/)
})

it('polls until a subsequent canonical snapshot proves the submitted position at a newer revision', async () => {
  const t = setup()
  const old = await t.read()
  t.read.mockClear()
  old.state.workspaces[0].nodes[1].position = originalPosition
  t.read.mockResolvedValueOnce(old)
  t.setCanonical({ revision: 6 })
  const write = await waitForWrite()
  const canonical = await diagnostics.waitForManagedCanonicalLayout(
    page,
    'agent',
    write,
    expectedTuple,
    300,
  )
  expect(canonical).toMatchObject({ revision: 6, position: submittedPosition })
  expect(t.read).toHaveBeenCalledTimes(2)
})

it.each([
  { revision: 4 },
  { resumeSessionId: 'A' },
  { resumeSessionIdVerified: false },
  { position: { x: submittedPosition.x, y: originalPosition.y } },
])('rejects incomplete canonical proof: %j', async invalid => {
  const t = setup()
  if ('revision' in invalid) {
    t.setCanonical({ revision: invalid.revision })
  }
  if ('resumeSessionId' in invalid) {
    t.node.agent.resumeSessionId = invalid.resumeSessionId
  }
  if ('resumeSessionIdVerified' in invalid) {
    t.node.agent.resumeSessionIdVerified = invalid.resumeSessionIdVerified
  }
  if ('position' in invalid) {
    t.node.position = invalid.position
  }
  const proof = async () => {
    const write = await waitForWrite()
    await diagnostics.waitForManagedCanonicalLayout(page, 'agent', write, expectedTuple, 20)
  }
  await expect(proof()).rejects.toThrow(/canonical snapshot/)
})
