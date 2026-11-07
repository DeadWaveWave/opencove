import { pathToFileURL } from 'node:url'
import path from 'node:path'
import { usage } from './errors'

function exampleUri(value: string): string {
  // Suggestions only: never resolve a relative path against the CLI process cwd.
  if (/^[a-z]:[\\/]/i.test(value) || value.startsWith('\\\\')) {
    return pathToFileURL(value, { windows: true }).href
  }
  if (value.startsWith('/')) {
    return pathToFileURL(value, { windows: false }).href
  }
  if (!/^[a-z][a-z\d+.-]*:/i.test(value)) {
    return pathToFileURL(path.posix.resolve('/path/to/project', value), { windows: false }).href
  }
  return 'file:///path/to/project/README.md'
}

/** File-URI wire fields, including generic API calls, are validated before IO. */
export function validateUriInputs(id: string, input: unknown): void {
  if (
    !/^(filesystem|gitWorktree)\./.test(id) &&
    !['session.launchAgentInMount', 'pty.spawnInMount'].includes(id)
  ) {
    return
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return
  }
  for (const [key, value] of Object.entries(input)) {
    if (
      !/^(uri|\w+Uri)$/.test(key) ||
      value === undefined ||
      (key === 'cwdUri' && value === null)
    ) {
      continue
    }
    let valid = false
    if (typeof value === 'string' && /^file:\/\//i.test(value.trim())) {
      try {
        const url = new URL(value)
        valid = url.protocol === 'file:' && url.pathname.startsWith('/')
      } catch {
        /* Present the same actionable diagnostic for malformed URLs. */
      }
    }
    if (!valid) {
      usage(
        `Invalid input for ${id}: ${key} expects an absolute file:// URI; received ${JSON.stringify(value)}.`,
        `For example: ${exampleUri(typeof value === 'string' ? value : '')}. Use the target's approved root URI, not the CLI working directory. Run opencove mount list --project "@self" --fields mountId,rootUri`,
      )
    }
  }
}
