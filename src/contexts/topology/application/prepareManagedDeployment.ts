import { decideManagedRuntimeUpdate } from '../domain/managedRuntimePolicy'
import type {
  ManagedDeploymentPort,
  ManagedDeploymentRecord,
  ManagedRuntimeInstallation,
} from './ports/ManagedDeploymentPort'

function failure(code: string): Error {
  return new Error(`[opencove-bootstrap:${code}] ${code}`)
}

/** Candidate verification happens before acquiring the deployment activation lock. */
export async function prepareManagedDeployment(
  port: ManagedDeploymentPort,
  candidate: ManagedRuntimeInstallation,
  operationId: string,
): Promise<void> {
  await port.exclusive(async () => {
    let prior = port.read()
    let observed = await port.observe()

    // A lost acknowledgement must not start a second process or roll back committed data.
    if (
      prior &&
      observed?.phase === 'candidate' &&
      observed.activationId === prior.operationId &&
      decideManagedRuntimeUpdate(prior.desired.build, observed.build) === 'reuse' &&
      ['active', 'starting', 'recovery_required'].includes(prior.phase)
    ) {
      prior = {
        ...prior,
        phase: 'active',
        active: prior.desired,
        instanceId: observed.instanceId,
        retiredBuildIds: retirePrevious(prior),
        revision: prior.revision + 1,
      }
      port.write(prior)
      await port.maintenance('activate', observed.instanceId, prior.operationId)
      observed = { ...observed, phase: 'active' }
    }
    if (prior?.phase === 'recovery_required' || prior?.phase === 'starting') {
      throw failure('recovery_required')
    }
    if (prior && observed?.phase === 'maintenance') {
      await port.maintenance('release', observed.instanceId, prior.operationId)
      observed = { ...observed, phase: 'active' }
    }

    if (prior?.retiredBuildIds?.includes(candidate.build.buildId)) {
      throw failure('client_update_required')
    }

    const decision = decideManagedRuntimeUpdate(
      candidate.build,
      observed?.build ?? prior?.active?.build ?? null,
    )
    if (decision !== 'reuse' && decision !== 'prepare') {
      throw failure(decision)
    }
    if (decision === 'reuse' && observed?.phase === 'active') {
      return
    }

    let record: ManagedDeploymentRecord = {
      version: 1,
      revision: (prior?.revision ?? 0) + 1,
      operationId,
      phase: 'prepared',
      desired: candidate,
      active: prior?.active ?? null,
      previous: prior?.previous ?? null,
      snapshot: prior?.snapshot ?? null,
      instanceId: observed?.instanceId ?? null,
      retiredBuildIds: prior?.retiredBuildIds ?? [],
    }
    const save = (update: Partial<ManagedDeploymentRecord>): void => {
      record = { ...record, ...update, revision: record.revision + 1 }
      port.write(record)
    }
    port.write(record)
    if (observed) {
      if (!(await port.maintenance('acquire', observed.instanceId, operationId))) {
        throw failure('runtime_busy')
      }
      save({ phase: 'maintenance' })
      // On interruption, leave the journal intact for the next controller to reconcile.
      await port.maintenance('stop', observed.instanceId, operationId)
      await port.waitStopped(observed.instanceId)
    }
    save({ phase: 'stopped' })
    // Snapshot/preflight only reads the live profile. A failure here can be retried safely.
    save({ snapshot: await port.snapshot(operationId) })
    try {
      save({ phase: 'starting', instanceId: null, previous: record.active })
      const started = await port.start(candidate, operationId)
      if (
        decideManagedRuntimeUpdate(candidate.build, started.build) !== 'reuse' ||
        started.phase !== 'candidate'
      ) {
        throw failure('runtime_corrupt')
      }
      save({
        phase: 'active',
        active: candidate,
        instanceId: started.instanceId,
        retiredBuildIds: retirePrevious(record),
      })
      await port.maintenance('activate', started.instanceId, operationId)
    } catch (error) {
      // Once committed, never describe a lost activation acknowledgement as a migration failure.
      if (record.phase !== 'active') {
        save({ phase: 'recovery_required' })
      }
      throw error
    }
  })
}

function retirePrevious(record: ManagedDeploymentRecord): string[] {
  const retired = new Set(record.retiredBuildIds ?? [])
  if (record.active && record.active.build.buildId !== record.desired.build.buildId) {
    retired.add(record.active.build.buildId)
  }
  return [...retired]
}
