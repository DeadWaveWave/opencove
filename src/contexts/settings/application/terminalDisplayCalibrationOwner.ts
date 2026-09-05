import {
  createTerminalDisplayProfileKey,
  createTerminalDisplayReference,
  createTerminalDisplayReferenceSignature,
  isTerminalDisplayCalibrationForReference,
  isTerminalDisplayReferenceCurrent,
  isTerminalDisplayReferenceForProfile,
  type TerminalDisplayReference,
} from '../domain/terminalDisplayCalibration'
import {
  createTerminalDisplayCalibrationFromCandidate,
  runTerminalDisplayCalibrationSingleFlight,
} from './terminalDisplayAutoCalibration'

import type {
  ManualTerminalDisplayCalibrationResult,
  ManualTerminalDisplayReferenceResult,
  TerminalDisplayCalibrationAttemptOutcome,
  TerminalDisplayCalibrationContext,
  TerminalDisplayCalibrationMetadata,
  TerminalDisplayCalibrationOwner,
  TerminalDisplayCalibrationOwnerPorts,
  TerminalDisplayCalibrationOwnerSnapshot,
  TerminalDisplayEnvironmentObservation,
} from './terminalDisplayCalibrationOwner.types'
export type * from './terminalDisplayCalibrationOwner.types'

function rendererBlocker(
  observation: TerminalDisplayEnvironmentObservation,
  reference: TerminalDisplayReference,
): 'no-terminal' | 'mixed-renderers' | 'renderer-mismatch' | null {
  if (observation.rendererKind === 'none') {
    return 'no-terminal'
  }
  if (observation.rendererKind === 'mixed') {
    return 'mixed-renderers'
  }
  return observation.rendererKind === reference.capture?.rendererKind ? null : 'renderer-mismatch'
}

function contextKey(context: TerminalDisplayCalibrationContext): string {
  return JSON.stringify({
    enabled: context.enabled,
    profileKey: createTerminalDisplayProfileKey({
      terminalFontSize: context.terminalFontSize,
      terminalFontFamily: context.terminalFontFamily,
    }),
    reference: createTerminalDisplayReferenceSignature(context.reference),
  })
}

function snapshotKey(snapshot: TerminalDisplayCalibrationOwnerSnapshot): string {
  const calibration = snapshot.appliedCalibration
  return JSON.stringify({
    calibration: calibration
      ? {
          profileKey: calibration.profileKey,
          fontSize: calibration.fontSize,
          lineHeight: calibration.lineHeight,
          letterSpacing: calibration.letterSpacing,
          target: calibration.target,
          measured: calibration.measured ?? null,
          score: calibration.score,
        }
      : null,
    environmentSignature: snapshot.environmentSignature,
    status: snapshot.status,
  })
}

export function createTerminalDisplayCalibrationOwner(
  ports: TerminalDisplayCalibrationOwnerPorts,
): TerminalDisplayCalibrationOwner {
  let currentContext: TerminalDisplayCalibrationContext | null = null
  let currentContextKey = 'none'
  let observationKey: string | null = null
  let generation = 0
  let disposed = false
  let snapshot: TerminalDisplayCalibrationOwnerSnapshot = {
    appliedCalibration: null,
    environmentSignature: null,
    status: 'idle',
  }
  const listeners = new Set<() => void>()
  const inFlight = new Set<Promise<void>>()

  const publish = (next: TerminalDisplayCalibrationOwnerSnapshot): void => {
    if (snapshotKey(snapshot) === snapshotKey(next)) {
      return
    }
    snapshot = next
    for (const listener of listeners) {
      listener()
    }
  }

  const isCurrent = (expectedGeneration: number): boolean =>
    !disposed && generation === expectedGeneration

  const recordAttempt = (
    expectedGeneration: number,
    status: TerminalDisplayCalibrationAttemptOutcome,
    environmentSignature?: string,
  ): void => {
    if (!isCurrent(expectedGeneration)) {
      return
    }
    ports.recordAttempt?.(status, environmentSignature)
    if (isCurrent(expectedGeneration)) {
      publish({ ...snapshot, status })
    }
  }

  const reconcile = async (
    context: TerminalDisplayCalibrationContext,
    expectedGeneration: number,
    observation: TerminalDisplayEnvironmentObservation,
  ): Promise<void> => {
    if (!context.enabled) {
      recordAttempt(expectedGeneration, 'disabled')
      return
    }
    const reference =
      isTerminalDisplayReferenceForProfile(context.reference, {
        terminalFontSize: context.terminalFontSize,
        terminalFontFamily: context.terminalFontFamily,
      }) && isTerminalDisplayReferenceCurrent(context.reference)
        ? context.reference
        : null
    if (!reference) {
      recordAttempt(expectedGeneration, 'reference-unavailable')
      return
    }

    const blocker = rendererBlocker(observation, reference)
    if (blocker) {
      recordAttempt(expectedGeneration, blocker)
      return
    }

    const environment = await ports.resolveEnvironment({ ...context, reference }).catch(() => null)
    if (!environment || !isCurrent(expectedGeneration)) {
      if (isCurrent(expectedGeneration)) {
        recordAttempt(expectedGeneration, 'environment-unstable')
      }
      return
    }
    if (reference.capture.rendererKind !== environment.rendererKind) {
      recordAttempt(expectedGeneration, 'renderer-mismatch', environment.signature)
      return
    }
    if (ports.isSuppressed(environment.signature)) {
      recordAttempt(expectedGeneration, 'suppressed', environment.signature)
      return
    }

    const stored = ports.readStored()
    const storedMatches =
      stored !== null &&
      stored.metadata?.environmentSignature === environment.signature &&
      isTerminalDisplayCalibrationForReference(stored.calibration, reference)
    if (storedMatches) {
      if (stored.proof !== 'atomic') {
        const promoted = ports.writeStored(stored.calibration, stored.metadata!)
        if (!promoted || !isCurrent(expectedGeneration)) {
          recordAttempt(expectedGeneration, 'storage-unavailable', environment.signature)
          return
        }
      }
      publish({
        appliedCalibration: stored.calibration,
        environmentSignature: environment.signature,
        status: 'already-calibrated',
      })
      recordAttempt(expectedGeneration, 'already-calibrated', environment.signature)
      return
    }

    const result = await runTerminalDisplayCalibrationSingleFlight(
      environment.signature,
      async () =>
        ports.calibrate({
          terminalFontSize: context.terminalFontSize,
          terminalFontFamily: context.terminalFontFamily,
          reference,
          rendererKind: environment.rendererKind,
        }),
    ).catch(() => null)
    if (!result || !isCurrent(expectedGeneration)) {
      if (isCurrent(expectedGeneration)) {
        recordAttempt(expectedGeneration, 'candidate-unavailable', environment.signature)
      }
      return
    }

    const confirmedEnvironment = await ports
      .resolveEnvironment({ ...context, reference })
      .catch(() => null)
    if (
      !confirmedEnvironment ||
      confirmedEnvironment.signature !== environment.signature ||
      confirmedEnvironment.rendererKind !== environment.rendererKind ||
      !isCurrent(expectedGeneration) ||
      ports.isSuppressed(environment.signature)
    ) {
      if (isCurrent(expectedGeneration)) {
        recordAttempt(expectedGeneration, 'environment-unstable', environment.signature)
      }
      return
    }

    const calibration = createTerminalDisplayCalibrationFromCandidate({
      profileKey: createTerminalDisplayProfileKey({
        terminalFontSize: context.terminalFontSize,
        terminalFontFamily: context.terminalFontFamily,
      }),
      reference,
      result,
    })
    if (!calibration) {
      recordAttempt(expectedGeneration, 'candidate-rejected', environment.signature)
      return
    }

    const metadata: TerminalDisplayCalibrationMetadata = {
      environmentSignature: environment.signature,
      source: 'automatic',
    }
    if (!ports.writeStored(calibration, metadata) || !isCurrent(expectedGeneration)) {
      recordAttempt(expectedGeneration, 'storage-unavailable', environment.signature)
      return
    }

    publish({
      appliedCalibration: calibration,
      environmentSignature: environment.signature,
      status: 'applied',
    })
    recordAttempt(expectedGeneration, 'applied', environment.signature)
  }

  const captureReferenceNow = async (): Promise<ManualTerminalDisplayReferenceResult> => {
    const context = currentContext
    if (!context || disposed) {
      return { outcome: 'measurement-unavailable' }
    }
    const expectedContextKey = currentContextKey
    const captured = await ports
      .measureReference({
        terminalFontSize: context.terminalFontSize,
        terminalFontFamily: context.terminalFontFamily,
      })
      .catch(() => null)
    if (!captured || disposed || currentContextKey !== expectedContextKey) {
      return { outcome: 'measurement-unavailable' }
    }
    return {
      outcome: 'captured',
      reference: createTerminalDisplayReference(captured),
    }
  }

  const calibrateNow = async (): Promise<ManualTerminalDisplayCalibrationResult> => {
    const context = currentContext
    if (!context || disposed) {
      return { outcome: 'reference-unavailable' }
    }
    const reference =
      isTerminalDisplayReferenceForProfile(context.reference, {
        terminalFontSize: context.terminalFontSize,
        terminalFontFamily: context.terminalFontFamily,
      }) && isTerminalDisplayReferenceCurrent(context.reference)
        ? context.reference
        : null
    if (!reference) {
      return { outcome: 'reference-unavailable' }
    }

    generation += 1
    const expectedGeneration = generation
    const observation = ports.readEnvironmentObservation()
    observationKey = JSON.stringify(observation)
    publish({ appliedCalibration: null, environmentSignature: null, status: 'checking' })
    const operation = (async (): Promise<ManualTerminalDisplayCalibrationResult> => {
      const blocker = rendererBlocker(observation, reference)
      if (blocker) {
        return { outcome: blocker }
      }
      const environment = await ports
        .resolveEnvironment({ ...context, reference })
        .catch(() => null)
      if (
        !environment ||
        reference.capture.rendererKind !== environment.rendererKind ||
        !isCurrent(expectedGeneration)
      ) {
        return { outcome: 'environment-unstable' }
      }
      const result = await ports
        .calibrate({
          terminalFontSize: context.terminalFontSize,
          terminalFontFamily: context.terminalFontFamily,
          reference,
          rendererKind: environment.rendererKind,
        })
        .catch(() => null)
      if (!result || !isCurrent(expectedGeneration)) {
        return { outcome: 'candidate-unavailable' }
      }
      const confirmedEnvironment = await ports
        .resolveEnvironment({ ...context, reference })
        .catch(() => null)
      if (
        !confirmedEnvironment ||
        confirmedEnvironment.signature !== environment.signature ||
        confirmedEnvironment.rendererKind !== environment.rendererKind ||
        !isCurrent(expectedGeneration)
      ) {
        return { outcome: 'environment-unstable' }
      }
      const calibration = createTerminalDisplayCalibrationFromCandidate({
        profileKey: createTerminalDisplayProfileKey({
          terminalFontSize: context.terminalFontSize,
          terminalFontFamily: context.terminalFontFamily,
        }),
        reference,
        result,
      })
      if (!calibration) {
        return { outcome: 'candidate-rejected', score: result.score }
      }
      if (
        !ports.writeStored(calibration, {
          environmentSignature: environment.signature,
          source: 'manual',
        }) ||
        !isCurrent(expectedGeneration)
      ) {
        return { outcome: 'storage-unavailable' }
      }
      if (context.enabled) {
        publish({
          appliedCalibration: calibration,
          environmentSignature: environment.signature,
          status: 'applied',
        })
      }
      return { outcome: 'saved', score: result.score }
    })().catch(() => ({ outcome: 'candidate-unavailable' as const }))
    const tracked = operation.then(result => {
      if (isCurrent(expectedGeneration)) {
        publish({
          ...snapshot,
          status:
            result.outcome === 'saved'
              ? context.enabled
                ? 'applied'
                : 'disabled'
              : result.outcome,
        })
      }
    })
    inFlight.add(tracked)
    const cleanup = (): void => {
      inFlight.delete(tracked)
    }
    void tracked.then(cleanup, cleanup)
    return await operation
  }

  const start = (): void => {
    const context = currentContext
    if (!context || disposed) {
      return
    }
    generation += 1
    const expectedGeneration = generation
    const observation = ports.readEnvironmentObservation()
    observationKey = JSON.stringify(observation)
    publish({ appliedCalibration: null, environmentSignature: null, status: 'checking' })
    const operation = reconcile(context, expectedGeneration, observation).catch(() => {
      if (isCurrent(expectedGeneration)) {
        recordAttempt(expectedGeneration, 'environment-unstable')
      }
    })
    inFlight.add(operation)
    const cleanup = (): void => {
      inFlight.delete(operation)
    }
    void operation.then(cleanup, cleanup)
  }

  return {
    update: context => {
      if (disposed) {
        return
      }
      const nextKey = contextKey(context)
      currentContext = context
      if (nextKey === currentContextKey) {
        return
      }
      currentContextKey = nextKey
      start()
    },
    observeEnvironment: () => {
      if (disposed || !currentContext?.enabled) {
        return
      }
      if (
        JSON.stringify(ports.readEnvironmentObservation()) === observationKey &&
        snapshot.status !== 'environment-unstable'
      ) {
        return
      }
      start()
    },
    refresh: () => {
      start()
    },
    captureReferenceNow,
    calibrateNow,
    reset: () => {
      if (disposed) {
        return false
      }
      generation += 1
      const stored = ports.readStored()
      const environmentSignature =
        snapshot.environmentSignature ?? stored?.metadata?.environmentSignature ?? null
      const cleared = ports.clearStored({ suppressEnvironmentSignature: environmentSignature })
      publish({
        appliedCalibration: null,
        environmentSignature: null,
        status: !cleared ? 'storage-unavailable' : environmentSignature ? 'suppressed' : 'idle',
      })
      return cleared
    },
    getSnapshot: () => snapshot,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    whenIdle: async () => {
      /* eslint-disable no-await-in-loop -- each pass also joins operations added by prior completion effects */
      while (inFlight.size > 0) {
        await Promise.allSettled([...inFlight])
      }
      /* eslint-enable no-await-in-loop */
    },
    dispose: () => {
      if (disposed) {
        return
      }
      disposed = true
      generation += 1
      currentContext = null
      publish({ appliedCalibration: null, environmentSignature: null, status: 'idle' })
      listeners.clear()
    },
  }
}
