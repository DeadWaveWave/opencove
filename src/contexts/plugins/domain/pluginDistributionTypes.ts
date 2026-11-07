import type { PluginManifest } from './pluginTypes'

import type { PluginBuildStrategy } from '@shared/contracts/controlSurface/operations/pluginInputTypes'
export type {
  PluginBuildStrategy,
  PluginGitInstallInput,
} from '@shared/contracts/controlSurface/operations/pluginInputTypes'
export interface PluginGitSource {
  kind: 'git'
  repository: string
  ref: string
  upstreamCommit: string
  checkoutCommit: string
  /** Editable repository root, distinct from the published artifact. */
  directory: string
  packageDirectory: string
  build: PluginBuildStrategy
}
export interface PluginPublicationExpectation {
  revision: string
  runtimeGeneration: number
  runtimeEpoch: string
  sourceDirectory: string
}
export interface PluginGitCandidate {
  id: string
  pluginId: string | null
  directory: string
  source: PluginGitSource
  expected: PluginPublicationExpectation | null
  baseSource?: { directory: string; fingerprint: string }
  status: 'prepared' | 'conflict' | 'failed' | 'published'
  error?: string
}
export interface PluginDistributionResult {
  status: 'installed' | 'updated' | 'conflict' | 'failed'
  plugin?: PluginManifest
  candidateId: string
  candidateDirectory: string
  error?: string
}
