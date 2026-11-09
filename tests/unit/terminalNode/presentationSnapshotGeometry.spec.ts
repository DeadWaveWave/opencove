import { describe, expect, it, vi } from 'vitest'
import type { PresentationSnapshotTerminalResult } from '../../../src/shared/contracts/dto'
import { requestPresentationSnapshotAfterGeometry } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/presentationSnapshotGeometry'

const expectedGeometry = { cols: 69, rows: 48, geometryRevision: 7 }
const newer: PresentationSnapshotTerminalResult = {
  sessionId: 'geometry-fence',
  epoch: 1,
  appliedSeq: 44,
  presentationRevision: 51,
  cols: 52,
  rows: 36,
  geometryRevision: 8,
  bufferKind: 'alternate',
  cursor: { x: 0, y: 0 },
  title: null,
  serializedScreen: 'ready',
}
const request = (snapshot: PresentationSnapshotTerminalResult, expected = expectedGeometry) =>
  requestPresentationSnapshotAfterGeometry({
    sessionId: newer.sessionId,
    expectedGeometry: expected,
    requestSnapshot: async () => snapshot,
    maxAttempts: 1,
  })

describe('post-geometry snapshot revision fence', () => {
  it('accepts a newer canonical revision for the requested session instead of locking the old size', async () => {
    expect(await request(newer)).toBe(newer)
  })

  it.each([
    { name: 'older revision', snapshot: { ...newer, geometryRevision: 6 } },
    {
      name: 'older revision even at the requested size',
      snapshot: { ...newer, ...expectedGeometry, geometryRevision: 6 },
    },
    { name: 'same revision with conflicting size', snapshot: { ...newer, geometryRevision: 7 } },
    {
      name: 'another session with a larger revision',
      snapshot: { ...newer, sessionId: 'foreign' },
    },
    { name: 'unversioned candidate', snapshot: { ...newer, geometryRevision: null } },
  ])('rejects $name', async ({ snapshot }) => {
    expect(await request(snapshot)).toBeNull()
  })

  it.each([
    { cols: 69, rows: 48 },
    { cols: 69, rows: 48, geometryRevision: null },
    { cols: 69, rows: 48, geometryRevision: undefined },
  ])('keeps strict dimension matching when a fence is unknown: %j', async geometry => {
    expect(
      await requestPresentationSnapshotAfterGeometry({
        sessionId: newer.sessionId,
        expectedGeometry: geometry,
        requestSnapshot: async () => newer,
        maxAttempts: 1,
      }),
    ).toBeNull()
  })

  it('keeps output and visibility fences when geometry advances', async () => {
    const requestSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ ...newer, appliedSeq: 42 })
      .mockResolvedValueOnce({ ...newer, serializedScreen: '\x1b[?2004h' })
      .mockResolvedValueOnce(newer)
    const result = await requestPresentationSnapshotAfterGeometry({
      sessionId: newer.sessionId,
      expectedGeometry,
      minAppliedSeqExclusive: 42,
      requireMeaningfulSerializedScreen: true,
      requestSnapshot,
      wait: async () => undefined,
    })
    expect(result).toBe(newer)
    expect(requestSnapshot).toHaveBeenCalledTimes(3)
  })

  it('uses the accepted resize ACK revision rather than only the initial baseline revision', async () => {
    // The resize ACK already confirmed revision 9; revision 8 cannot satisfy it.
    expect(await request(newer, { ...expectedGeometry, geometryRevision: 9 })).toBeNull()
  })

  it('does not mistake the presentation epoch for a Worker generation identity', async () => {
    expect(await request({ ...newer, epoch: 1 })).toMatchObject({ geometryRevision: 8 })
    expect(
      await request({ ...newer, sessionId: 'replacement-with-the-same-epoch', epoch: 1 }),
    ).toBeNull()
  })
})
