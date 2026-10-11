import { normalizeLocalPluginPackage, pluginRecord } from '../domain/localPluginValidation'
import type { PluginRepositoryDetails } from '../domain/pluginRepositoryTypes'

export function githubRepository(value: string): { repository: string; slug: string } {
  const url = new URL(value)
  const match = /^\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/.exec(url.pathname)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'github.com' ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !match
  ) {
    throw new Error('Repository details require a public https://github.com/owner/repository URL.')
  }
  const slug = `${match[1]}/${match[2]}`
  return { repository: `https://github.com/${slug}`, slug }
}

export async function githubJson(
  path: string,
  limit = 1024 * 1024,
): Promise<Record<string, unknown> | null> {
  const response = await fetch(`https://api.github.com/${path}`, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenCove' },
    signal: AbortSignal.timeout(10_000),
    redirect: 'error',
  })
  if (response.status === 404) {
    await response.body?.cancel()
    return null
  }
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(
      `GitHub details unavailable (${response.status}). Check network access or GitHub rate limits.`,
    )
  }
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    throw new Error('GitHub response exceeds the documentation size limit.')
  }
  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('GitHub returned an empty response.')
  }
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      // Stream reads are sequential so the byte budget is enforced before reading more.
      // eslint-disable-next-line no-await-in-loop
      const chunk = await reader.read()
      if (chunk.done) {
        break
      }
      size += chunk.value.length
      if (size > limit) {
        throw new Error('GitHub response exceeds the documentation size limit.')
      }
      chunks.push(chunk.value)
    }
  } finally {
    await reader.cancel()
    reader.releaseLock()
  }
  return pluginRecord(JSON.parse(Buffer.concat(chunks).toString('utf8')))
}

function content(file: Record<string, unknown>, max: number): string {
  if (
    file.type !== 'file' ||
    file.encoding !== 'base64' ||
    typeof file.content !== 'string' ||
    typeof file.size !== 'number' ||
    file.size > max
  ) {
    throw new Error('Repository documentation must be a regular UTF-8 file within the size limit.')
  }
  const bytes = Buffer.from(file.content, 'base64')
  if (bytes.length > max) {
    throw new Error('Repository documentation exceeds the size limit.')
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

/** Pin all inspected files to one commit; never clone, build, or execute discovery content. */
export async function inspectGithubPluginRepository(url: string): Promise<PluginRepositoryDetails> {
  const { repository, slug } = githubRepository(url)
  const metadata = await githubJson(`repos/${slug}`)
  if (!metadata) {
    throw new Error('Public GitHub repository was not found.')
  }
  const ref = String(metadata.default_branch ?? '')
  const revision = await githubJson(`repos/${slug}/commits/${encodeURIComponent(ref)}`)
  const commit = String(revision?.sha ?? '')
  if (!/^[a-f0-9]{40,64}$/.test(commit)) {
    throw new Error('GitHub did not return a repository commit.')
  }
  const base = `repos/${slug}`
  const [readmeFile, manifestFile] = await Promise.all([
    githubJson(`${base}/readme?ref=${commit}`, 512 * 1024),
    githubJson(`${base}/contents/opencove.plugin.json?ref=${commit}`, 128 * 1024),
  ])
  let manifest: PluginRepositoryDetails['manifest'] = null
  let manifestError: string | null = null
  try {
    if (manifestFile) {
      manifest = normalizeLocalPluginPackage(JSON.parse(content(manifestFile, 64 * 1024)))
    } else {
      manifestError =
        'No root opencove.plugin.json was found. This repository may require a package directory or build; inspect its README before installing.'
    }
  } catch (error) {
    manifestError = error instanceof Error ? error.message : String(error)
  }
  const readmePath = readmeFile && typeof readmeFile.path === 'string' ? readmeFile.path : null
  return {
    repository,
    name: slug,
    ref,
    commit,
    description: String(metadata.description ?? '').slice(0, 2000),
    stars: Number(metadata.stargazers_count ?? 0),
    readme: readmeFile ? content(readmeFile, 256 * 1024) : '',
    readmePath,
    manifest,
    manifestError,
  }
}
