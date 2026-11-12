import { pluginRecord, pluginString } from './localPluginValidation'
import type { PluginGitSource } from './pluginDistributionTypes'
import { gitInstallInput } from '@shared/contracts/controlSurface/operations/pluginDistributionInput'
export {
  distributionFields,
  pluginGitRef,
  pluginSourcePath,
  pluginBuild,
  gitInstallInput,
} from '@shared/contracts/controlSurface/operations/pluginDistributionInput'
export function readPluginGitSource(value: unknown): PluginGitSource {
  const record = pluginRecord(value)
  const input = gitInstallInput({
    repository: record.repository,
    ref: record.ref,
    directory: record.packageDirectory,
    build: record.build,
  })
  const hash = (raw: unknown) => {
    const commit = pluginString(raw, 'commit', 64)
    if (!/^[a-f0-9]{40,64}$/.test(commit)) {
      throw new Error('Invalid Git commit id.')
    }
    return commit
  }
  if (record.kind !== 'git') {
    throw new Error('Unknown plugin source kind.')
  }
  return {
    kind: 'git',
    repository: input.repository,
    ref: input.ref!,
    packageDirectory: input.directory!,
    build: input.build!,
    upstreamCommit: hash(record.upstreamCommit),
    checkoutCommit: hash(record.checkoutCommit),
    directory: pluginString(record.directory, 'source directory', 4096),
  }
}
