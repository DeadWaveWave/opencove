import type { PluginInstallationManager } from './PluginInstallationManager'
import type { PluginFilesPort } from './PluginRuntimePorts'
import type { PluginDistributionPort } from './PluginDistributionPort'
import type {
  PluginDistributionResult,
  PluginGitCandidate,
  PluginGitInstallInput,
} from '../domain/pluginDistributionTypes'

/** Candidate IO is isolated; only the installation manager may publish a generation. */
export class PluginDistributionService {
  private operations: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly manager: PluginInstallationManager,
    private readonly files: PluginFilesPort,
    private readonly source: PluginDistributionPort,
  ) {}
  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operations.then(operation)
    this.operations = result.catch(() => undefined)
    return result
  }
  private async expected(pluginId: string) {
    const { record, manifest, runtimeEpoch } = await this.manager.installationState(pluginId)
    return {
      record,
      expected: {
        revision: record.revision,
        runtimeGeneration: manifest.runtimeGeneration!,
        runtimeEpoch,
        sourceDirectory: record.sourceDirectory,
      },
    }
  }
  async install(input: PluginGitInstallInput): Promise<PluginDistributionResult> {
    return this.serialize(async () => this.publish(await this.source.clone(input)))
  }
  async update(pluginId: string, ref?: string): Promise<PluginDistributionResult> {
    return this.serialize(async () => {
      const { record, expected } = await this.expected(pluginId)
      if (!record.distribution) {
        throw new Error('This installation has no managed Git source.')
      }
      const candidate = await this.source.merge(record.distribution, ref)
      candidate.pluginId = pluginId
      candidate.expected = expected
      await this.source.save(candidate)
      if (candidate.status === 'conflict') {
        return this.result(candidate, 'conflict')
      }
      return this.publish(candidate)
    })
  }
  async rebuild(
    pluginId: string,
  ): Promise<PluginDistributionResult | import('../domain/pluginTypes').PluginManifest> {
    return this.serialize(async () => {
      const { record, expected } = await this.expected(pluginId)
      if (!record.distribution) {
        return this.manager.reload(pluginId)
      }
      const candidate = await this.source.rebuild(record.distribution)
      candidate.pluginId = pluginId
      candidate.expected = expected
      await this.source.save(candidate)
      return this.publish(candidate)
    })
  }
  async apply(candidateId: string): Promise<PluginDistributionResult> {
    return this.serialize(async () => this.publish(await this.source.candidate(candidateId)))
  }
  private result(
    candidate: PluginGitCandidate,
    status: PluginDistributionResult['status'],
  ): PluginDistributionResult {
    return {
      status,
      candidateId: candidate.id,
      candidateDirectory: candidate.directory,
      ...(candidate.error ? { error: candidate.error } : {}),
    }
  }
  private async publish(candidate: PluginGitCandidate): Promise<PluginDistributionResult> {
    if (candidate.status === 'published') {
      throw new Error('Candidate already published; prepare a new update.')
    }
    try {
      if (candidate.expected && candidate.pluginId) {
        const current = await this.expected(candidate.pluginId)
        if (JSON.stringify(current.expected) !== JSON.stringify(candidate.expected)) {
          throw new Error(
            'Candidate is stale after installation change or Worker restart; prepare a fresh update.',
          )
        }
      }
      const directory = await this.source.build(candidate)
      const snapshot = await this.files.snapshot(directory)
      if (candidate.pluginId && snapshot.package.id !== candidate.pluginId) {
        throw new Error('A Git update cannot change plugin id.')
      }
      candidate.pluginId = snapshot.package.id
      if (
        candidate.baseSource &&
        (await this.source.fingerprint(candidate.baseSource.directory)) !==
          candidate.baseSource.fingerprint
      ) {
        throw new Error(
          'Editable source changed while preparing this candidate; prepare a fresh update. Personal files are untouched.',
        )
      }
      const plugin = await this.manager.publishPrepared(
        { ...snapshot, sourceDirectory: candidate.directory, distribution: candidate.source },
        candidate.expected,
        async () => {
          if (
            candidate.baseSource &&
            (await this.source.fingerprint(candidate.baseSource.directory)) !==
              candidate.baseSource.fingerprint
          ) {
            throw new Error(
              'Editable source changed during activation; candidate was not published.',
            )
          }
        },
      )
      candidate.status = 'published'
      delete candidate.error
      // The active registry is authoritative; diagnostics cannot undo a successful publication.
      await this.source.save(candidate).catch(() => undefined)
      return { ...this.result(candidate, candidate.expected ? 'updated' : 'installed'), plugin }
    } catch (error) {
      candidate.status = 'failed'
      candidate.error = error instanceof Error ? error.message : String(error)
      await this.source.save(candidate)
      return this.result(candidate, 'failed')
    }
  }
  async check(pluginId: string, ref?: string) {
    const { record } = await this.manager.installationState(pluginId)
    if (!record.distribution) {
      throw new Error('This installation has no managed Git source.')
    }
    return this.source.check(record.distribution, ref)
  }
  async inspect(pluginId: string) {
    const { record, expected } = await this.expected(pluginId)
    const fingerprint = record.distribution
      ? await this.source.fingerprint(record.sourceDirectory)
      : null
    const observation = record.distribution
      ? await this.source.inspect(record.distribution)
      : { dirty: false, headCommit: null }
    return {
      pluginId,
      sourceDirectory: record.sourceDirectory,
      distribution: record.distribution ?? null,
      ...observation,
      history: (record.history ?? []).map(item => ({
        revision: item.revision,
        version: item.package.version,
        sourceDirectory: item.sourceDirectory,
        upstreamCommit: item.distribution?.upstreamCommit,
      })),
      candidates: (await this.source.candidates(pluginId))
        .filter(item => item.status !== 'published')
        .map(item => ({
          id: item.id,
          directory: item.directory,
          status: item.status,
          error: item.error,
          stale:
            item.expected && JSON.stringify(item.expected) !== JSON.stringify(expected)
              ? ('installation' as const)
              : item.baseSource && item.baseSource.fingerprint !== fingerprint
                ? ('source' as const)
                : null,
        })),
    }
  }
  async rollback(pluginId: string, revision: string) {
    return this.serialize(async () => {
      const { record, expected } = await this.expected(pluginId)
      const version = record.history?.find(item => item.revision === revision)
      if (!version) {
        throw new Error('Revision is not in this installation’s retained code history.')
      }
      const snapshot = await this.files.restore({ ...version, enabled: record.enabled })
      return this.manager.publishPrepared(snapshot, expected)
    })
  }
  repositoryDetails(repository: string) {
    return this.source.repositoryDetails(repository)
  }
  discover(query: string) {
    return this.source.discover(query)
  }
}
