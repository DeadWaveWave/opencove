import { describe, expect, it, vi } from 'vitest'
import { createTerminalDisplayCalibrationOwner } from '@contexts/settings/application/terminalDisplayCalibrationOwner'
import type {
  TerminalClientDisplayCalibration,
  TerminalDisplayReference,
} from '@contexts/settings/domain/terminalDisplayCalibration'

const reference: TerminalDisplayReference = {
  version: 1,
  capture: { algorithmVersion: 1, rendererKind: 'webgl' },
  measurement: {
    fontSize: 13,
    fontFamily: null,
    lineHeight: 1,
    letterSpacing: 0,
    cols: 80,
    rows: 24,
    cssCellWidth: 7.5,
    cssCellHeight: 15,
    effectiveDpr: 2,
    windowDevicePixelRatio: 2,
    visualViewportScale: 1,
    runtime: 'desktop',
    measuredAt: '2026-09-01T00:00:00.000Z',
  },
}

const calibration: TerminalClientDisplayCalibration = {
  version: 1,
  profileKey: JSON.stringify({ fontSize: 13, fontFamily: null }),
  fontSize: 12.75,
  lineHeight: 1,
  letterSpacing: 0,
  target: {
    cols: 80,
    rows: 24,
    cssCellWidth: 7.5,
    cssCellHeight: 15,
    effectiveDpr: 2,
  },
  measured: {
    cols: 80,
    rows: 24,
    cssCellWidth: 7.5,
    cssCellHeight: 15,
    effectiveDpr: 2,
  },
  score: 0,
  measuredAt: '2026-09-01T00:00:01.000Z',
}

const context = {
  enabled: true,
  terminalFontSize: 13,
  terminalFontFamily: null,
  reference,
}

function createPorts(options?: {
  stored?: {
    calibration: TerminalClientDisplayCalibration
    metadata: { environmentSignature: string; source: 'automatic' | 'manual' } | null
    proof: 'atomic' | 'legacy' | null
  } | null
}) {
  let stored = options?.stored ?? null
  return {
    ports: {
      readStored: vi.fn(() => stored),
      writeStored: vi.fn(
        (
          next: TerminalClientDisplayCalibration,
          metadata: { environmentSignature: string; source: 'automatic' | 'manual' },
        ) => {
          stored = { calibration: next, metadata, proof: 'atomic' as const }
          return true
        },
      ),
      clearStored: vi.fn(() => {
        stored = null
        return true
      }),
      isSuppressed: vi.fn(() => false),
      readEnvironmentObservation: vi.fn(() => ({
        runtime: 'desktop' as const,
        rendererKind: 'webgl' as const,
        windowDevicePixelRatio: 2,
        visualViewportScale: 1,
      })),
      resolveEnvironment: vi.fn(async () => ({
        signature: 'environment-a',
        rendererKind: 'webgl' as const,
      })),
      measureReference: vi.fn(async () => ({
        measurement: reference.measurement,
        rendererKind: 'webgl' as const,
      })),
      calibrate: vi.fn(async () => null),
      recordAttempt: vi.fn(),
    },
    getStored: () => stored,
  }
}

describe('terminal display calibration owner', () => {
  it('does not let a completed attempt overwrite a newer subscriber-driven disable', async () => {
    const { ports } = createPorts({
      stored: {
        calibration,
        metadata: { environmentSignature: 'environment-a', source: 'manual' },
        proof: 'atomic',
      },
    })
    const owner = createTerminalDisplayCalibrationOwner(ports)
    owner.subscribe(() => {
      if (owner.getSnapshot().appliedCalibration) {
        owner.update({ ...context, enabled: false })
      }
    })
    owner.update(context)
    await owner.whenIdle()
    expect(owner.getSnapshot()).toMatchObject({ appliedCalibration: null, status: 'disabled' })
    expect(ports.recordAttempt).toHaveBeenLastCalledWith('disabled', undefined)
    owner.dispose()
  })

  it('does not restart a pending verification for repeated observations or equivalent settings', async () => {
    const { ports } = createPorts({
      stored: {
        calibration,
        metadata: { environmentSignature: 'environment-a', source: 'manual' },
        proof: 'atomic',
      },
    })
    let finish!: (value: { signature: string; rendererKind: 'webgl' }) => void
    ports.resolveEnvironment.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        }),
    )
    const owner = createTerminalDisplayCalibrationOwner(ports)
    owner.update(context)
    owner.observeEnvironment()
    owner.update(structuredClone(context))
    owner.observeEnvironment()
    expect(ports.resolveEnvironment).toHaveBeenCalledTimes(1)
    expect(owner.getSnapshot().status).toBe('checking')
    finish({ signature: 'environment-a', rendererKind: 'webgl' })
    await owner.whenIdle()
    expect(owner.getSnapshot()).toMatchObject({
      appliedCalibration: calibration,
      status: 'already-calibrated',
    })
    owner.dispose()
  })

  it.each([
    ['mixed', 'mixed-renderers'],
    ['none', 'no-terminal'],
    ['dom', 'renderer-mismatch'],
  ] as const)(
    'keeps the %s blocker consistent for automatic and manual calibration',
    async (rendererKind, status) => {
      const { ports } = createPorts()
      ports.readEnvironmentObservation.mockReturnValue({
        ...ports.readEnvironmentObservation(),
        rendererKind,
      })
      const owner = createTerminalDisplayCalibrationOwner(ports)
      owner.update(context)
      await owner.whenIdle()
      expect(owner.getSnapshot()).toMatchObject({ appliedCalibration: null, status })
      await expect(owner.calibrateNow()).resolves.toEqual({ outcome: status })
      expect(owner.getSnapshot()).toMatchObject({ appliedCalibration: null, status })
      expect(ports.resolveEnvironment).not.toHaveBeenCalled()
      expect(ports.writeStored).not.toHaveBeenCalled()
      owner.dispose()
    },
  )

  it('never applies a metadata-less stored calibration', async () => {
    const { ports } = createPorts({
      stored: { calibration, metadata: null, proof: null },
    })
    const owner = createTerminalDisplayCalibrationOwner(ports)

    owner.update(context)
    await owner.whenIdle()

    expect(owner.getSnapshot().appliedCalibration).toBeNull()
    expect(ports.calibrate).toHaveBeenCalledTimes(1)
    owner.dispose()
  })

  it('verifies and promotes a legacy sidecar before applying it', async () => {
    const { ports, getStored } = createPorts({
      stored: {
        calibration,
        metadata: { environmentSignature: 'environment-a', source: 'automatic' },
        proof: 'legacy',
      },
    })
    const owner = createTerminalDisplayCalibrationOwner(ports)

    owner.update(context)
    await owner.whenIdle()

    expect(ports.writeStored).toHaveBeenCalledWith(calibration, {
      environmentSignature: 'environment-a',
      source: 'automatic',
    })
    expect(getStored()?.proof).toBe('atomic')
    expect(owner.getSnapshot().appliedCalibration).toEqual(calibration)
    expect(ports.calibrate).not.toHaveBeenCalled()
    owner.dispose()
  })

  it('revokes applicability synchronously before environment revalidation', async () => {
    let resolveEnvironment: ((value: { signature: string; rendererKind: 'webgl' }) => void) | null =
      null
    const deferredEnvironment = new Promise<{ signature: string; rendererKind: 'webgl' }>(
      resolve => {
        resolveEnvironment = resolve
      },
    )
    const { ports } = createPorts({
      stored: {
        calibration,
        metadata: { environmentSignature: 'environment-a', source: 'automatic' },
        proof: 'atomic',
      },
    })
    const owner = createTerminalDisplayCalibrationOwner(ports)
    owner.update(context)
    await owner.whenIdle()
    expect(owner.getSnapshot().appliedCalibration).toEqual(calibration)

    ports.resolveEnvironment.mockImplementationOnce(async () => await deferredEnvironment)
    owner.refresh()

    expect(owner.getSnapshot().appliedCalibration).toBeNull()
    resolveEnvironment?.({ signature: 'environment-b', rendererKind: 'webgl' })
    await owner.whenIdle()
    expect(owner.getSnapshot().appliedCalibration).toBeNull()
    owner.dispose()
  })

  it('fences an older environment result after the profile changes', async () => {
    let resolveOld: ((value: { signature: string; rendererKind: 'webgl' }) => void) | null = null
    const oldEnvironment = new Promise<{ signature: string; rendererKind: 'webgl' }>(resolve => {
      resolveOld = resolve
    })
    const { ports } = createPorts({
      stored: {
        calibration,
        metadata: { environmentSignature: 'environment-a', source: 'automatic' },
        proof: 'atomic',
      },
    })
    ports.resolveEnvironment.mockImplementationOnce(async () => await oldEnvironment)
    const owner = createTerminalDisplayCalibrationOwner(ports)

    owner.update(context)
    owner.update({ ...context, terminalFontSize: 14 })
    resolveOld?.({ signature: 'environment-a', rendererKind: 'webgl' })
    await owner.whenIdle()

    expect(owner.getSnapshot().appliedCalibration).toBeNull()
    owner.dispose()
  })

  it('fences manual reference capture when the appearance profile changes in flight', async () => {
    const { ports } = createPorts()
    let resolveCapture!: (value: {
      measurement: TerminalDisplayReference['measurement']
      rendererKind: 'webgl'
    }) => void
    ports.measureReference.mockImplementationOnce(
      async () =>
        await new Promise(resolve => {
          resolveCapture = resolve
        }),
    )
    const owner = createTerminalDisplayCalibrationOwner(ports)
    owner.update(context)
    await owner.whenIdle()

    const capture = owner.captureReferenceNow()
    owner.update({ ...context, terminalFontSize: 14 })
    resolveCapture({ measurement: reference.measurement, rendererKind: 'webgl' })

    await expect(capture).resolves.toEqual({ outcome: 'measurement-unavailable' })
    owner.dispose()
  })

  it('keeps manual calibration unapplied when its proof cannot be stored', async () => {
    const { ports } = createPorts()
    ports.calibrate.mockResolvedValue({
      candidate: { fontSize: 12.75, lineHeight: 1, letterSpacing: 0 },
      measurement: { ...reference.measurement, measuredAt: '2026-09-01T00:00:01.000Z' },
      score: 0,
    })
    ports.writeStored.mockReturnValue(false)
    const owner = createTerminalDisplayCalibrationOwner(ports)
    owner.update({ ...context, enabled: false })
    await owner.whenIdle()

    await expect(owner.calibrateNow()).resolves.toEqual({ outcome: 'storage-unavailable' })
    expect(owner.getSnapshot().appliedCalibration).toBeNull()
    owner.dispose()
  })

  it('applies a generated calibration only after the proof write succeeds', async () => {
    const { ports } = createPorts()
    ports.calibrate.mockResolvedValue({
      candidate: { fontSize: 12.75, lineHeight: 1, letterSpacing: 0 },
      measurement: { ...reference.measurement, measuredAt: '2026-09-01T00:00:01.000Z' },
      score: 0,
    })
    const owner = createTerminalDisplayCalibrationOwner(ports)

    owner.update(context)
    await owner.whenIdle()

    expect(ports.writeStored).toHaveBeenCalledTimes(1)
    expect(owner.getSnapshot().appliedCalibration).toMatchObject({ fontSize: 12.75 })

    ports.readStored.mockReturnValue(null)
    ports.writeStored.mockReturnValue(false)
    owner.refresh()
    await owner.whenIdle()
    expect(owner.getSnapshot().appliedCalibration).toBeNull()
    owner.dispose()
  })
})
