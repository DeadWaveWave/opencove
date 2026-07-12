import { describe, expect, it } from 'vitest'
import {
  bindTerminalRecoveryRecord,
  composeTerminalRecoveryScrollback,
  commitTerminalRecoveryRecord,
  reserveTerminalRecoveryRecord,
  type TerminalRecoveryRecord,
  type TerminalRuntimeBinding,
} from '../../../src/contexts/terminal/domain/recovery/terminalRecovery'

const NOW = '2026-07-10T00:00:00.000Z'

function localBinding(sessionId: string, runtimeEpoch: string): TerminalRuntimeBinding {
  return {
    sessionId,
    runtimeEpoch,
    route: {
      kind: 'local',
      workerInstanceId: 'worker-1',
    },
  }
}

function remoteBinding(homeWorkerInstanceId: string): TerminalRuntimeBinding {
  return {
    sessionId: 'home-session-1',
    runtimeEpoch: 'remote-epoch-1',
    route: {
      kind: 'remote',
      homeWorkerInstanceId,
      endpointId: 'endpoint-1',
      remoteSessionId: 'remote-session-1',
      targetWorkerInstanceId: 'remote-worker-1',
    },
  }
}

function existingRecord(): TerminalRecoveryRecord {
  return {
    nodeId: 'node-1',
    formatVersion: 1,
    generation: 1,
    binding: localBinding('session-1', 'epoch-1'),
    archivedEpochs: [],
    historyTruncated: false,
    checkpoint: {
      checkpointRevision: 4,
      appliedSeq: 8,
      presentationRevision: 3,
      cols: 80,
      rows: 24,
      geometryRevision: 2,
      bufferKind: 'normal',
      cursor: { x: 2, y: 4 },
      title: 'shell',
      serializedScreen: 'old screen',
    },
    rawTail: 'old raw',
    rawTruncated: false,
    checksum: 'old-checksum',
    updatedAt: NOW,
  }
}

describe('terminal recovery domain', () => {
  it('archives the prior checkpoint before opening a clean runtime generation', () => {
    const result = reserveTerminalRecoveryRecord({
      current: existingRecord(),
      nodeId: 'node-1',
      generation: 2,
      now: '2026-07-10T00:01:00.000Z',
    })

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      record: {
        generation: 2,
        binding: null,
        archivedEpochs: [
          {
            runtimeEpoch: 'epoch-1',
            serializedScreen: 'old screen',
          },
        ],
        rawTail: '',
        checkpoint: null,
      },
    })
  })

  it('composes three runtime epochs without continuing an archived TUI into the new shell', () => {
    const first = existingRecord()
    first.checkpoint = {
      ...first.checkpoint!,
      serializedScreen: 'EPOCH_ONE_PROMPT',
    }

    const secondReservation = reserveTerminalRecoveryRecord({
      current: first,
      nodeId: 'node-1',
      generation: 2,
      now: NOW,
    })
    expect(secondReservation).toMatchObject({
      ok: true,
      record: {
        checkpoint: null,
        archivedEpochs: [{ runtimeEpoch: 'epoch-1', serializedScreen: 'EPOCH_ONE_PROMPT' }],
      },
    })
    if (!secondReservation.ok) {
      return
    }
    const secondBinding = localBinding('session-2', 'epoch-2')
    const secondBind = bindTerminalRecoveryRecord({
      current: secondReservation.record,
      nodeId: 'node-1',
      generation: 2,
      binding: secondBinding,
      now: NOW,
    })
    if (!secondBind.ok) {
      throw new Error('second epoch bind failed')
    }
    const secondCommit = commitTerminalRecoveryRecord({
      current: secondBind.record,
      nodeId: 'node-1',
      generation: 2,
      binding: secondBinding,
      checkpoint: {
        ...first.checkpoint!,
        checkpointRevision: 1,
        bufferKind: 'alternate',
        serializedScreen: '\u001b[?1049h\u001b[HARCHIVED_TUI_EPOCH_TWO',
      },
      rawTail: 'epoch two raw',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })
    if (!secondCommit.ok) {
      throw new Error('second epoch commit failed')
    }

    const thirdReservation = reserveTerminalRecoveryRecord({
      current: secondCommit.record,
      nodeId: 'node-1',
      generation: 3,
      now: NOW,
    })
    if (!thirdReservation.ok) {
      throw new Error('third epoch reservation failed')
    }
    const thirdBinding = localBinding('session-3', 'epoch-3')
    const thirdBind = bindTerminalRecoveryRecord({
      current: thirdReservation.record,
      nodeId: 'node-1',
      generation: 3,
      binding: thirdBinding,
      now: NOW,
    })
    if (!thirdBind.ok) {
      throw new Error('third epoch bind failed')
    }
    const thirdCommit = commitTerminalRecoveryRecord({
      current: thirdBind.record,
      nodeId: 'node-1',
      generation: 3,
      binding: thirdBinding,
      checkpoint: {
        ...first.checkpoint!,
        checkpointRevision: 1,
        serializedScreen: 'EPOCH_THREE_NEW_SHELL',
      },
      rawTail: 'epoch three raw',
      rawTruncated: false,
      checksum: null,
      now: NOW,
    })
    if (!thirdCommit.ok) {
      throw new Error('third epoch commit failed')
    }

    const recovered = composeTerminalRecoveryScrollback(thirdCommit.record)
    const firstIndex = recovered.indexOf('EPOCH_ONE_PROMPT')
    const secondIndex = recovered.indexOf('ARCHIVED_TUI_EPOCH_TWO')
    const thirdIndex = recovered.indexOf('EPOCH_THREE_NEW_SHELL')
    expect([firstIndex, secondIndex, thirdIndex]).toEqual([
      expect.any(Number),
      expect.any(Number),
      expect.any(Number),
    ])
    expect(firstIndex).toBeLessThan(secondIndex)
    expect(secondIndex).toBeLessThan(thirdIndex)
    expect(recovered.slice(secondIndex, thirdIndex)).toContain('\u001b[?1049l')
    expect(recovered.slice(secondIndex, thirdIndex)).not.toContain('\u001b[?1049h')
    expect(thirdCommit.record.archivedEpochs.map(epoch => epoch.runtimeEpoch)).toEqual([
      'epoch-1',
      'epoch-2',
    ])
    expect(thirdCommit.record.checkpoint?.serializedScreen).toBe('EPOCH_THREE_NEW_SHELL')
  })

  it('drops a single oversized ANSI checkpoint as a whole and marks history truncated', () => {
    const current = existingRecord()
    const oversizedCheckpoint = `\u001b[31m${'X'.repeat(400_000)}\u001b[0m`
    current.checkpoint = {
      ...current.checkpoint!,
      serializedScreen: oversizedCheckpoint,
    }

    const result = reserveTerminalRecoveryRecord({
      current,
      nodeId: 'node-1',
      generation: 2,
      now: NOW,
    })
    if (!result.ok) {
      throw new Error('oversized checkpoint reservation failed')
    }

    expect(oversizedCheckpoint.length).toBeGreaterThan(400_000)
    expect(result.record.archivedEpochs).toEqual([])
    expect(result.record.historyTruncated).toBe(true)
    expect(composeTerminalRecoveryScrollback(result.record)).toBe('')
  })

  it('rejects stale generations and conflicting bindings', () => {
    const current = existingRecord()

    expect(
      reserveTerminalRecoveryRecord({
        current,
        nodeId: 'node-1',
        generation: 0,
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'stale_generation' })

    expect(
      bindTerminalRecoveryRecord({
        current,
        nodeId: 'node-1',
        generation: 1,
        binding: localBinding('session-2', 'epoch-2'),
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'binding_conflict' })
  })

  it('refreshes only the Home transport identity for a surviving remote runtime epoch', () => {
    const current = existingRecord()
    current.binding = remoteBinding('home-worker-1')

    const result = bindTerminalRecoveryRecord({
      current,
      nodeId: 'node-1',
      generation: 1,
      binding: remoteBinding('home-worker-2'),
      now: '2026-07-10T00:01:00.000Z',
    })

    expect(result).toMatchObject({
      ok: true,
      changed: true,
      record: {
        generation: 1,
        binding: {
          runtimeEpoch: 'remote-epoch-1',
          route: { homeWorkerInstanceId: 'home-worker-2' },
        },
        archivedEpochs: [],
        checkpoint: { serializedScreen: 'old screen' },
      },
    })
  })

  it('commits only a newer checkpoint from the accepted binding', () => {
    const current = existingRecord()
    const checkpoint = {
      ...current.checkpoint!,
      checkpointRevision: 5,
      appliedSeq: 9,
      serializedScreen: 'new screen',
    }

    expect(
      commitTerminalRecoveryRecord({
        current,
        nodeId: 'node-1',
        generation: 0,
        binding: current.binding!,
        checkpoint,
        rawTail: 'new raw',
        rawTruncated: false,
        checksum: 'new-checksum',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'stale_generation' })

    expect(
      commitTerminalRecoveryRecord({
        current,
        nodeId: 'node-1',
        generation: 1,
        binding: localBinding('other-session', 'epoch-1'),
        checkpoint,
        rawTail: 'new raw',
        rawTruncated: false,
        checksum: 'new-checksum',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'binding_mismatch' })

    expect(
      commitTerminalRecoveryRecord({
        current,
        nodeId: 'node-1',
        generation: 1,
        binding: current.binding!,
        checkpoint: { ...checkpoint, checkpointRevision: 4 },
        rawTail: 'new raw',
        rawTruncated: false,
        checksum: 'new-checksum',
        now: NOW,
      }),
    ).toEqual({ ok: false, reason: 'stale_checkpoint' })

    expect(
      commitTerminalRecoveryRecord({
        current,
        nodeId: 'node-1',
        generation: 1,
        binding: current.binding!,
        checkpoint,
        rawTail: 'new raw',
        rawTruncated: true,
        checksum: 'new-checksum',
        now: NOW,
      }),
    ).toMatchObject({
      ok: true,
      changed: true,
      record: {
        checkpoint: { checkpointRevision: 5, appliedSeq: 9 },
        rawTail: 'new raw',
        rawTruncated: true,
        checksum: 'new-checksum',
      },
    })
  })
})
