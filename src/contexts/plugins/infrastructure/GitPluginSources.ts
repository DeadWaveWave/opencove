import {
  inspectGithubPluginRepository,
  githubJson,
  githubRepository,
} from './GithubPluginRepository'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PluginDistributionPort } from '../application/PluginDistributionPort'
import type {
  PluginGitCandidate,
  PluginGitInstallInput,
  PluginGitSource,
} from '../domain/pluginDistributionTypes'
import { gitInstallInput, pluginGitRef } from '../domain/pluginDistributionValidation'
import { pluginRecord, pluginString } from '../domain/localPluginValidation'
import { writePluginJson } from './LocalPluginFiles'
import { copyPersonalSource, git, runBuild, within, sourceFingerprint } from './pluginGitCommands'

export class GitPluginSources implements PluginDistributionPort {
  private readonly root: string
  constructor(userDataPath: string) {
    this.root = resolve(userDataPath, 'plugins', 'git')
  }
  fingerprint(directory: string) {
    return sourceFingerprint(directory)
  }
  private async newDirectory() {
    const id = randomUUID()
    const directory = join(this.root, 'sources', id)
    await mkdir(join(this.root, 'sources'), { recursive: true })
    return { id, directory }
  }
  private async resolveRef(directory: string, repository: string, ref?: string) {
    const requested = ref ? pluginGitRef(ref) : 'HEAD'
    const output = await git(directory, [
      'ls-remote',
      '--symref',
      '--',
      repository,
      requested,
      ...(requested.startsWith('refs/tags/') ? [`${requested}^{}`] : []),
      `refs/heads/${requested}`,
      `refs/tags/${requested}`,
      `refs/tags/${requested}^{}`,
    ])
    const rows = output.split('\n')
    const symbolic = rows.find(line => line.startsWith('ref: '))?.split(/\s+/)[1]
    const commits = rows
      .filter(line => /^[a-f0-9]{40,64}\s/.test(line))
      .map(line => line.split(/\s+/))
    const resolvedRef = requested === 'HEAD' ? (symbolic ?? 'HEAD') : requested
    const peeled = commits.find(row => row[1].endsWith('^{}'))
    const matches = [...new Set(commits.filter(row => !row[1].endsWith('^{}')).map(row => row[0]))]
    const names = new Set(commits.map(row => row[1].replace(/\^\{\}$/, '')))
    if (names.size > 1 || (matches.length > 1 && !peeled)) {
      throw new Error('Git ref is ambiguous; use refs/heads/name or refs/tags/name.')
    }
    const commit =
      peeled?.[0] ?? matches[0] ?? (/^[a-f0-9]{40,64}$/.test(requested) ? requested : null)
    if (!commit) {
      throw new Error('Git ref does not exist on the remote.')
    }
    return { ref: resolvedRef, commit }
  }
  async clone(raw: PluginGitInstallInput): Promise<PluginGitCandidate> {
    const input = gitInstallInput(raw)
    const location = await this.newDirectory()
    await git(this.root, [
      'clone',
      '--no-hardlinks',
      '--no-checkout',
      '--',
      input.repository,
      location.directory,
    ])
    const target = await this.resolveRef(location.directory, input.repository, input.ref)
    await git(location.directory, ['fetch', '--no-tags', '--', 'origin', target.commit])
    await git(location.directory, ['checkout', '--detach', `${target.commit}^{commit}`])
    const candidate: PluginGitCandidate = {
      ...location,
      pluginId: null,
      expected: null,
      status: 'prepared',
      source: {
        kind: 'git',
        repository: input.repository,
        ref: target.ref,
        upstreamCommit: target.commit,
        checkoutCommit: target.commit,
        directory: location.directory,
        packageDirectory: input.directory!,
        build: input.build!,
      },
    }
    await this.save(candidate)
    return candidate
  }
  rebuild(source: PluginGitSource) {
    return this.prepare(source, undefined, false)
  }
  merge(source: PluginGitSource, ref?: string) {
    return this.prepare(source, ref, true)
  }
  private async prepare(
    source: PluginGitSource,
    ref: string | undefined,
    update: boolean,
  ): Promise<PluginGitCandidate> {
    const fingerprint = await sourceFingerprint(source.directory)
    const before = await this.inspect(source)
    const location = await this.newDirectory()
    await git(this.root, [
      'clone',
      '--no-hardlinks',
      '--no-checkout',
      '--',
      source.directory,
      location.directory,
    ])
    await git(location.directory, ['checkout', '--detach', before.headCommit])
    await copyPersonalSource(source.directory, location.directory)
    await git(location.directory, ['remote', 'set-url', 'origin', source.repository])
    const target = update
      ? await this.resolveRef(location.directory, source.repository, ref ?? source.ref)
      : { ref: source.ref, commit: source.upstreamCommit }
    if (update) {
      await git(location.directory, ['fetch', '--no-tags', '--', 'origin', target.commit])
    }
    const candidate: PluginGitCandidate = {
      ...location,
      pluginId: null,
      expected: null,
      baseSource: { directory: source.directory, fingerprint },
      status: 'prepared',
      source: {
        ...source,
        directory: location.directory,
        ref: target.ref,
        upstreamCommit: target.commit,
        checkoutCommit: await git(location.directory, ['rev-parse', 'HEAD']),
      },
    }
    try {
      await git(location.directory, [
        '-c',
        'user.name=OpenCove',
        '-c',
        'user.email=plugins@opencove.local',
        'merge',
        '--no-edit',
        '--no-autostash',
        target.commit,
      ])
      candidate.source.checkoutCommit = await git(location.directory, ['rev-parse', 'HEAD'])
    } catch (error) {
      if (!(await git(location.directory, ['ls-files', '--unmerged']))) {
        throw error
      }
      candidate.status = 'conflict'
      candidate.error =
        'Upstream conflicts with personal source. Resolve and commit the retained candidate, then explicitly apply it; the active version is unchanged.'
    }
    const after = await this.inspect(source)
    if (
      before.headCommit !== after.headCommit ||
      fingerprint !== (await sourceFingerprint(source.directory))
    ) {
      throw new Error(
        `Source HEAD changed while preparing update; candidate retained at ${candidate.directory}.`,
      )
    }
    await this.save(candidate)
    return candidate
  }
  async build(candidate: PluginGitCandidate): Promise<string> {
    if (await git(candidate.directory, ['ls-files', '--unmerged'])) {
      throw new Error('Candidate has unresolved merge conflicts.')
    }
    const source = candidate.source
    const directory = await within(candidate.directory, source.packageDirectory)
    const build = source.build
    if (build.kind !== 'none') {
      const lock = join(directory, build.kind === 'npm' ? 'package-lock.json' : 'pnpm-lock.yaml')
      if (!(await stat(lock).catch(() => null))?.isFile()) {
        throw new Error('A frozen dependency lockfile is required for source builds.')
      }
      await runBuild(directory, build.kind, build.script)
    }
    candidate.source.checkoutCommit = await git(candidate.directory, ['rev-parse', 'HEAD'])
    return within(directory, build.kind === 'none' ? '.' : build.outputDirectory)
  }
  async check(source: PluginGitSource, ref?: string) {
    const target = await this.resolveRef(source.directory, source.repository, ref ?? source.ref)
    return {
      currentCommit: source.upstreamCommit,
      availableCommit: target.commit,
      ref: target.ref,
      updateAvailable: source.upstreamCommit !== target.commit,
    }
  }
  async inspect(source: PluginGitSource) {
    return {
      dirty: Boolean(await git(source.directory, ['status', '--porcelain'])),
      headCommit: await git(source.directory, ['rev-parse', 'HEAD']),
    }
  }
  async save(candidate: PluginGitCandidate) {
    await writePluginJson(join(this.root, 'candidates', `${candidate.id}.json`), candidate)
  }
  async candidate(id: string): Promise<PluginGitCandidate> {
    if (!/^[a-f0-9-]{36}$/.test(id)) {
      throw new Error('Invalid candidate id.')
    }
    const candidate = JSON.parse(
      await readFile(join(this.root, 'candidates', `${id}.json`), 'utf8'),
    ) as PluginGitCandidate
    if (
      candidate.id !== id ||
      candidate.directory !== join(this.root, 'sources', id) ||
      candidate.source.directory !== candidate.directory
    ) {
      throw new Error('Invalid candidate source identity.')
    }
    return candidate
  }
  async candidates(pluginId: string) {
    const entries = await readdir(join(this.root, 'candidates')).catch(error => {
      if (error.code === 'ENOENT') {
        return []
      }
      throw error
    })
    const candidates = await Promise.all(
      entries.filter(name => name.endsWith('.json')).map(name => this.candidate(name.slice(0, -5))),
    )
    return candidates.filter(item => item.pluginId === pluginId)
  }
  repositoryDetails(repository: string) {
    return inspectGithubPluginRepository(repository)
  }
  async discover(query: string) {
    const search = pluginString(query || 'opencove', 'search', 200)
    const body = await githubJson(
      `search/repositories?q=${encodeURIComponent(`topic:opencove-plugin ${search === 'opencove' ? '' : search}`)}&per_page=20`,
    )
    if (!body) {
      throw new Error('GitHub plugin search was not found.')
    }
    const repositories = (Array.isArray(body.items) ? body.items : []).slice(0, 20).map(value => {
      const item = pluginRecord(value)
      const location = githubRepository(String(item.html_url ?? ''))
      return {
        name: String(item.full_name ?? ''),
        url: location.repository,
        description: String(item.description ?? ''),
        stars: Number(item.stargazers_count ?? 0),
        updatedAt: String(item.updated_at ?? ''),
      }
    })
    return { repositories, source: 'github' as const, installAutomatically: false as const }
  }
}
