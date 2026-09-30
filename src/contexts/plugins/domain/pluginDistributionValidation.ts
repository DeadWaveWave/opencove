import { pluginRecord, pluginString } from './localPluginValidation'
import type {
  PluginBuildStrategy,
  PluginGitInstallInput,
  PluginGitSource,
} from './pluginDistributionTypes'

export function distributionFields(value: unknown, fields: string[]): Record<string, unknown> {
  const record = pluginRecord(value)
  if (Object.keys(record).some(key => !fields.includes(key))) {
    throw new Error('Unsupported plugin distribution field.')
  }
  return record
}
export function pluginGitRef(value: unknown): string {
  const ref = pluginString(value, 'Git ref', 240)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(ref) || ref.includes('..') || ref.endsWith('/')) {
    throw new Error(
      'Use a Git branch, tag or full commit id; revision expressions are unsupported.',
    )
  }
  return ref
}
export function pluginSourcePath(value: unknown): string {
  const path = pluginString(value, 'repository directory', 500)
  if (path === '.') {
    return path
  }
  if (
    path.startsWith('/') ||
    path.includes('\\') ||
    path.split('/').some(part => !part || part === '..' || part === '.git')
  ) {
    throw new Error('Repository paths must be relative and remain inside the checkout.')
  }
  return path
}
export function pluginBuild(value: unknown): PluginBuildStrategy {
  if (value === undefined) {
    return { kind: 'none' }
  }
  const record = distributionFields(value, ['kind', 'script', 'outputDirectory'])
  if (
    record.kind === 'none' &&
    record.script === undefined &&
    record.outputDirectory === undefined
  ) {
    return { kind: 'none' }
  }
  if (record.kind !== 'npm' && record.kind !== 'pnpm') {
    throw new Error('Build must be none, npm or pnpm.')
  }
  const script = pluginString(record.script, 'build script', 100)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/.test(script)) {
    throw new Error('Invalid build script name.')
  }
  return { kind: record.kind, script, outputDirectory: pluginSourcePath(record.outputDirectory) }
}
export function gitInstallInput(value: unknown): PluginGitInstallInput {
  const record = distributionFields(value, ['repository', 'ref', 'directory', 'build'])
  const repository = pluginString(record.repository, 'Git repository', 2000)
  const absolute = /^(\/|[A-Za-z]:[\\/])/.test(repository)
  if (
    [...repository].some(character => character.charCodeAt(0) < 32) ||
    (!absolute &&
      (/\s/.test(repository) || !/^(https:\/\/|ssh:\/\/|git@[a-zA-Z0-9.-]+:)/.test(repository)))
  ) {
    throw new Error('Use an HTTPS/SSH Git URL or an absolute repository path on this Worker.')
  }
  if (repository.startsWith('https://') && new URL(repository).username) {
    throw new Error(
      'Use Git credentials or SSH authentication; do not embed credentials in the repository URL.',
    )
  }
  return {
    repository,
    ref: record.ref === undefined ? undefined : pluginGitRef(record.ref),
    directory: record.directory === undefined ? '.' : pluginSourcePath(record.directory),
    build: pluginBuild(record.build),
  }
}
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
