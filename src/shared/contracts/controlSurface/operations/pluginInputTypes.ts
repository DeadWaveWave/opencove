export type PluginBuildStrategy =
  | { kind: 'none' }
  | { kind: 'npm' | 'pnpm'; script: string; outputDirectory: string }

export interface PluginGitInstallInput {
  repository: string
  ref?: string
  directory?: string
  build?: PluginBuildStrategy
}
export interface PluginHostContext {
  surface: 'commandCenter' | 'canvas' | 'node' | 'space' | 'sidebar'
  projectId?: string
  spaceId?: string
  nodeIds?: string[]
}
