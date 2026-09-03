import {
  createTerminalDisplayProfileKey,
  createTerminalDisplayReference,
  createTerminalDisplayReferenceSignature,
  isTerminalDisplayCalibrationForReference,
  isTerminalDisplayReferenceCurrent,
  isTerminalDisplayReferenceForProfile,
  type TerminalClientDisplayCalibration,
  type TerminalDisplayReference,
  type TerminalDisplayRendererKind,
} from '../domain/terminalDisplayCalibration'
import {
  createTerminalDisplayCalibrationFromCandidate,
  runTerminalDisplayCalibrationSingleFlight,
  type TerminalDisplayCalibrationCandidateResult,
} from './terminalDisplayAutoCalibration'

export type TerminalDisplayCalibrationMetadata = {
  environmentSignature: string
  source: 'automatic' | 'manual'
}

export type StoredTerminalDisplayCalibration = {
  calibration: TerminalClientDisplayCalibration
  metadata: TerminalDisplayCalibrationMetadata | null
  proof: 'atomic' | 'legacy' | null
}

export type TerminalDisplayCalibrationContext = {
  enabled: boolean
  terminalFontSize: number
  terminalFontFamily: string | null
  reference: TerminalDisplayReference | null
}

export type TerminalDisplayEnvironmentEvidence = {
  signature: string
  rendererKind: TerminalDisplayRendererKind
}

export type TerminalDisplayCalibrationOwnerSnapshot = {
  appliedCalibration: TerminalClientDisplayCalibration | null
  environmentSignature: string | null
}

export interface TerminalDisplayCalibrationOwnerPorts {
  readStored: () => StoredTerminalDisplayCalibration | null
  writeStored: (
    calibration: TerminalClientDisplayCalibration,
    metadata: TerminalDisplayCalibrationMetadata,
  ) => boolean
  clearStored: (options?: { suppressEnvironmentSignature?: string | null }) => boolean
  isSuppressed: (environmentSignature: string) => boolean
  resolveEnvironment: (
    context: Omit<TerminalDisplayCalibrationContext, 'enabled'> & {
      reference: TerminalDisplayReference
    },
  ) => Promise<TerminalDisplayEnvironmentEvidence | null>
  measureReference: (input: {
    terminalFontSize: number
    terminalFontFamily: string | null
  }) => Promise<{
    measurement: TerminalDisplayReference['measurement']
    rendererKind: TerminalDisplayRendererKind
  } | null>
  calibrate: (input: {
    terminalFontSize: number
    terminalFontFamily: string | null
    reference: TerminalDisplayReference
    rendererKind: TerminalDisplayRendererKind
  }) => Promise<TerminalDisplayCalibrationCandidateResult | null>
  recordAttempt?: (outcome: string, environmentSignature?: string) => void
}

export type ManualTerminalDisplayReferenceResult =
  | { outcome: 'captured'; reference: TerminalDisplayReference }
  | { outcome: 'measurement-unavailable' }

export type ManualTerminalDisplayCalibrationResult =
  | { outcome: 'saved'; score: number }
  | {
      outcome:
        | 'reference-unavailable'
        | 'environment-unstable'
        | 'candidate-unavailable'
        | 'storage-unavailable'
    }
  | { outcome: 'candidate-rejected'; score: number }

export interface TerminalDisplayCalibrationOwner {
  update: (context: TerminalDisplayCalibrationContext) => void
  invalidate: () => void
  refresh: () => void
  captureReferenceNow: () => Promise<ManualTerminalDisplayReferenceResult>
  calibrateNow: () => Promise<ManualTerminalDisplayCalibrationResult>
  reset: () => boolean
  getSnapshot: () => TerminalDisplayCalibrationOwnerSnapshot
  subscribe: (listener: () => void) => () => void
  whenIdle: () => Promise<void>
  dispose: () => void
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
  })
}

export function createTerminalDisplayCalibrationOwner(
  ports: TerminalDisplayCalibrationOwnerPorts,
): TerminalDisplayCalibrationOwner {
  let currentContext: TerminalDisplayCalibrationContext | null = null
  let currentContextKey = 'none'
  let generation = 0
  let disposed = false
  let snapshot: TerminalDisplayCalibrationOwnerSnapshot = {
    appliedCalibration: null,
    environmentSignature: null,
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

  const reconcile = async (
    context: TerminalDisplayCalibrationContext,
    expectedGeneration: number,
  ): Promise<void> => {
    if (!context.enabled) {
      ports.recordAttempt?.('disabled')
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
      ports.recordAttempt?.('reference-unavailable')
      return
    }

    const environment = await ports.resolveEnvironment({ ...context, reference }).catch(() => null)
    if (!environment || !isCurrent(expectedGeneration)) {
      if (isCurrent(expectedGeneration)) {
        ports.recordAttempt?.('environment-unstable')
      }
      return
    }
    if (reference.capture.rendererKind !== environment.rendererKind) {
      ports.recordAttempt?.('environment-unstable', environment.signature)
      return
    }
    if (ports.isSuppressed(environment.signature)) {
      ports.recordAttempt?.('suppressed', environment.signature)
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
          ports.recordAttempt?.('storage-unavailable', environment.signature)
          return
        }
      }
      publish({
        appliedCalibration: stored.calibration,
        environmentSignature: environment.signature,
      })
      ports.recordAttempt?.('already-calibrated', environment.signature)
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
        ports.recordAttempt?.('candidate-unavailable', environment.signature)
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
        ports.recordAttempt?.('environment-unstable', environment.signature)
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
      ports.recordAttempt?.('candidate-rejected', environment.signature)
      return
    }

    const metadata: TerminalDisplayCalibrationMetadata = {
      environmentSignature: environment.signature,
      source: 'automatic',
    }
    if (!ports.writeStored(calibration, metadata) || !isCurrent(expectedGeneration)) {
      ports.recordAttempt?.('storage-unavailable', environment.signature)
      return
    }

    publish({ appliedCalibration: calibration, environmentSignature: environment.signature })
    ports.recordAttempt?.('applied', environment.signature)
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
    publish({ appliedCalibration: null, environmentSignature: null })
    const operation = (async (): Promise<ManualTerminalDisplayCalibrationResult> => {
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
        })
      }
      return { outcome: 'saved', score: result.score }
    })().catch(() => ({ outcome: 'candidate-unavailable' as const }))
    const tracked = operation.then(() => undefined)
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
    publish({ appliedCalibration: null, environmentSignature: null })
    const operation = reconcile(context, expectedGeneration).catch(() => undefined)
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
    invalidate: () => {
      if (disposed) {
        return
      }
      generation += 1
      publish({ appliedCalibration: null, environmentSignature: null })
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
      publish({ appliedCalibration: null, environmentSignature: null })
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
      publish({ appliedCalibration: null, environmentSignature: null })
      listeners.clear()
    },
  }
}
