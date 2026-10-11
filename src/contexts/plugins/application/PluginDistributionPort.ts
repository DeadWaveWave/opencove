import type {
  PluginGitCandidate,
  PluginGitInstallInput,
  PluginGitSource,
} from '../domain/pluginDistributionTypes'
export interface PluginDistributionPort {
  repositoryDetails(
    repository: string,
  ): Promise<import('../domain/pluginRepositoryTypes').PluginRepositoryDetails>
  fingerprint(directory: string): Promise<string>
  clone(input: PluginGitInstallInput): Promise<PluginGitCandidate>
  rebuild(source: PluginGitSource): Promise<PluginGitCandidate>
  merge(source: PluginGitSource, ref?: string): Promise<PluginGitCandidate>
  build(candidate: PluginGitCandidate): Promise<string>
  check(
    source: PluginGitSource,
    ref?: string,
  ): Promise<{
    currentCommit: string
    availableCommit: string
    ref: string
    updateAvailable: boolean
  }>
  inspect(source: PluginGitSource): Promise<{ dirty: boolean; headCommit: string }>
  save(candidate: PluginGitCandidate): Promise<void>
  candidate(id: string): Promise<PluginGitCandidate>
  candidates(pluginId: string): Promise<PluginGitCandidate[]>
  discover(query: string): Promise<{
    repositories: Array<{
      name: string
      url: string
      description: string
      stars: number
      updatedAt: string
    }>
    source: 'github'
    installAutomatically: false
  }>
}
