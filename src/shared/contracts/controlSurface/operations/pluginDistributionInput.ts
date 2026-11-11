import { pluginRecord, pluginString } from './pluginPrimitives'
import type { PluginBuildStrategy, PluginGitInstallInput } from './pluginInputTypes'
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
  if (!absolute && (repository.startsWith('https://') || repository.startsWith('ssh://'))) {
    let url: URL
    try {
      url = new URL(repository)
    } catch {
      // URL parser errors may embed the original credential-bearing input.
      throw new Error('Use a valid HTTPS or SSH Git repository URL.')
    }
    if (url.password || (url.protocol === 'https:' && url.username) || url.search || url.hash) {
      throw new Error(
        'Use Git credentials or SSH authentication; do not embed credentials, query parameters or fragments in the repository URL.',
      )
    }
  }

  return {
    repository,
    ref: record.ref === undefined ? undefined : pluginGitRef(record.ref),
    directory: record.directory === undefined ? '.' : pluginSourcePath(record.directory),
    build: pluginBuild(record.build),
  }
}
