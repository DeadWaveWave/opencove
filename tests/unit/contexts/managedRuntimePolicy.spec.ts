import { describe, expect, it } from 'vitest'
import { decideManagedRuntimeUpdate } from '../../../src/contexts/topology/domain/managedRuntimePolicy'
import type { RuntimeBuildIdentity } from '../../../src/shared/contracts/runtimeBuild'

const desired: RuntimeBuildIdentity = {
  schemaVersion: 1,
  buildId: 'a'.repeat(64),
  appVersion: '0.3.1',
  channel: 'stable',
  protocolVersion: 2,
  ptyProtocolVersion: 1,
  launchContractVersion: 1,
  dataSchemaVersion: 13,
}

describe('managed runtime update policy', () => {
  it('requires a verified build even when the version string matches', () => {
    expect(decideManagedRuntimeUpdate(desired, null)).toBe('prepare')
    expect(decideManagedRuntimeUpdate(desired, { ...desired })).toBe('reuse')
    expect(decideManagedRuntimeUpdate(desired, { ...desired, buildId: 'b'.repeat(64) })).toBe(
      'conflicting_build',
    )
  })

  it('updates development builds with the same package version', () => {
    expect(
      decideManagedRuntimeUpdate(
        { ...desired, channel: 'dev' },
        { ...desired, channel: 'dev', buildId: 'b'.repeat(64) },
      ),
    ).toBe('prepare')
  })

  it('never automatically downgrades active data or changes release channels', () => {
    expect(decideManagedRuntimeUpdate(desired, { ...desired, appVersion: '0.4.0' })).toBe(
      'client_update_required',
    )
    expect(decideManagedRuntimeUpdate(desired, { ...desired, dataSchemaVersion: 14 })).toBe(
      'client_update_required',
    )
    expect(decideManagedRuntimeUpdate(desired, { ...desired, channel: 'nightly' })).toBe(
      'channel_conflict',
    )
  })

  it('does not infer protocol compatibility from semver or matching build IDs', () => {
    expect(decideManagedRuntimeUpdate(desired, { ...desired, protocolVersion: 3 })).toBe(
      'protocol_mismatch',
    )
    expect(decideManagedRuntimeUpdate(desired, { ...desired, ptyProtocolVersion: 2 })).toBe(
      'protocol_mismatch',
    )
    expect(decideManagedRuntimeUpdate(desired, { ...desired, appVersion: '0.3.0' })).toBe('prepare')
  })
})
