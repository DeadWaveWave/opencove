import type { LocalPluginPackage } from './pluginRuntimeTypes'

/** Read-only inspection of public GitHub content; no package code has been activated. */
export interface PluginRepositoryDetails {
  repository: string
  name: string
  ref: string
  commit: string
  description: string
  stars: number
  readme: string
  readmePath: string | null
  manifest: LocalPluginPackage | null
  manifestError: string | null
}
