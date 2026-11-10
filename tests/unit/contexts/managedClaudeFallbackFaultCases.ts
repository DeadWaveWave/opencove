import type { Edge } from './managedClaudeFaultModel'

export const shellFaults = [
  'none',
  'profile',
  'activity',
  'spawn',
  'registration',
  'activityCommit',
  'referenceRead',
  'cleanupKill',
] as const
export const shellEvents = [
  'none',
  'delete',
  'newer',
  'replace',
  'persist',
  'prepare',
  'peerLaunch',
  'peerRecovery',
  'peerDelete',
  'restart',
] as const
export type ShellCase = {
  route: 'plain' | 'mount'
  mode: 'stopped' | 'failedResume'
  fault: (typeof shellFaults)[number]
  event: (typeof shellEvents)[number]
  edge: Edge
  handoff: 'hold' | 'persist'
}
