// Reads ratchet baselines from git revisions and guards their update commands. A baseline is any
// tracked file whose name ends in `ratchet.json`. Rises are judged between the merge base M with
// `main` and the branch head H, never against the file in the same tree. Imports only `node:`
// built-ins and ./ratchet.mjs, so the update commands keep working without an install.
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  assertRatchetShape,
  compareRatchetTotals,
  formatRiseSection,
  ratchetTotals,
} from './ratchet.mjs'

export const BASELINE_SUFFIX = 'ratchet.json'
export const MAIN_REF = 'origin/main'
export const ACCEPT_RISE_FLAG = '--accept-rise'
/** Stands for the files on disk wherever a revision is expected (H of an update or a report). */
export const WORKING_TREE = 'working tree'

const SHORT_SHA_LENGTH = 8
const UNSHALLOW_HINT =
  'Run `git fetch --unshallow` (or `git fetch origin main`), or add the origin remote, to compare with the real merge base.'

function git(root, args) {
  const result = spawnSync('git', ['-c', 'core.quotepath=false', ...args], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return { ok: !result.error && result.status === 0, stdout: result.stdout ?? '' }
}

function resolveCommit(root, ref) {
  const result = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
  return result.ok ? result.stdout.trim() : null
}

function shortRev(rev) {
  return /^[0-9a-f]{40}$/.test(rev) ? rev.slice(0, SHORT_SHA_LENGTH) : rev
}

// Messages name the commit even when the caller passed a ref such as HEAD.
function describeRev(root, rev) {
  return rev === WORKING_TREE ? rev : shortRev(resolveCommit(root, rev) ?? rev)
}

/**
 * M for `head` against `base`: `{ rev, label, fallback, hint }`. `rev` is a commit, or `null` when
 * there is no commit (every total is then 0). It falls back to `head` itself, flagged by
 * `fallback`, when the merge base cannot be found. It never fetches.
 */
export function resolveMergeBase(root, base = MAIN_REF, head = 'HEAD') {
  const headSha = resolveCommit(root, head)
  if (!headSha) {
    return { rev: null, label: 'none', fallback: false, hint: null }
  }
  const fallback = reason => ({
    rev: headSha,
    label: `HEAD (${reason})`,
    fallback: true,
    hint: UNSHALLOW_HINT,
  })
  if (!resolveCommit(root, base)) {
    return fallback(`no ${base} in this clone`)
  }
  const mergeBase = git(root, ['merge-base', base, head])
  const sha = mergeBase.ok ? mergeBase.stdout.trim() : ''
  if (!sha) {
    return fallback(`no merge base with ${base}, the clone may be shallow`)
  }
  return {
    rev: sha,
    label: `merge base with ${base} (${shortRev(sha)})`,
    fallback: false,
    hint: null,
  }
}

function isBaselinePath(path) {
  return path.endsWith(BASELINE_SUFFIX)
}

/** Tracked baseline paths at `rev`. `null` has none; `WORKING_TREE` adds untracked, unignored files. */
export function listBaselinesAt(root, rev) {
  if (rev === null) {
    return []
  }
  const result =
    rev === WORKING_TREE
      ? git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      : git(root, ['ls-tree', '-r', '-z', '--name-only', rev])
  if (!result.ok) {
    throw new Error(`[ratchet] cannot list files at ${describeRev(root, rev)}`)
  }
  return [
    ...new Set(
      result.stdout
        .split('\0')
        .filter(
          path => isBaselinePath(path) && (rev !== WORKING_TREE || existsSync(join(root, path))),
        ),
    ),
  ].sort()
}

/** The parsed baseline at `rev`, `null` when the file is absent, and a throw when it is malformed. */
export function readBaselineAt(root, rev, path) {
  if (rev === null) {
    return null
  }
  let text
  if (rev === WORKING_TREE) {
    if (!existsSync(join(root, path))) {
      return null
    }
    text = readFileSync(join(root, path), 'utf8')
  } else {
    if (!git(root, ['cat-file', '-e', `${rev}:${path}`]).ok) {
      return null
    }
    text = git(root, ['show', `${rev}:${path}`]).stdout
  }
  let json
  try {
    json = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `[ratchet] ${path} at ${describeRev(root, rev)}: not valid JSON (${error.message}). A file whose name ends in ratchet.json is read as a ratchet baseline; rename it if it is not one.`,
      { cause: error },
    )
  }
  assertRatchetShape(path, describeRev(root, rev), json)
  return json
}

function entriesFor(path, before, after) {
  const { rises, retired } = compareRatchetTotals(ratchetTotals(before), ratchetTotals(after))
  return [
    ...rises.map(({ rule, from, to }) => ({ path, rule, from, to })),
    ...retired.map(({ rule, from }) => ({ path, rule, from, to: null })),
  ]
}

/** Every rise and retirement from `mergeBase` to `head`, as `{ path, rule, from, to }`. */
export function collectRatchetRises(root, mergeBase, head) {
  const paths = [...new Set([...listBaselinesAt(root, mergeBase), ...listBaselinesAt(root, head)])]
  const entries = paths
    .sort()
    .flatMap(path =>
      entriesFor(path, readBaselineAt(root, mergeBase, path), readBaselineAt(root, head, path)),
    )
  return entries.sort((left, right) =>
    left.path === right.path
      ? left.rule.localeCompare(right.rule)
      : left.path.localeCompare(right.path),
  )
}

/** Splits every `--accept-rise <rule>` (or `=<rule>`) out of `argv`; the rest goes back untouched. */
export function parseAcceptRises(argv) {
  const rules = []
  const rest = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument === ACCEPT_RISE_FLAG) {
      const rule = argv[index + 1]
      if (!rule || rule.startsWith('--')) {
        throw new Error(`${ACCEPT_RISE_FLAG} needs a rule id.`)
      }
      rules.push(rule)
      index += 1
    } else if (argument.startsWith(`${ACCEPT_RISE_FLAG}=`)) {
      const rule = argument.slice(ACCEPT_RISE_FLAG.length + 1)
      if (!rule) {
        throw new Error(`${ACCEPT_RISE_FLAG} needs a rule id.`)
      }
      rules.push(rule)
    } else {
      rest.push(argument)
    }
  }
  return { rules, rest }
}

function perFileRises(before, after) {
  const rises = []
  for (const rule of Object.keys(after).sort()) {
    for (const [file, count] of Object.entries(after[rule]).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const was = before[rule]?.[file] ?? 0
      if (count > was) {
        rises.push({ rule, file, from: was, to: count })
      }
    }
  }
  return rises
}

function describeEntry({ rule, from, to }) {
  return to === null
    ? `${rule}: the rule would be removed (its total was ${from}).`
    : `${rule}: total would rise from ${from} to ${to}.`
}

/**
 * Judges the baseline `next` (an object or its serialized JSON) for `path` against M. Returns
 * `{ ok, text }`: when `ok` is false nothing may be written and `text` is the refusal; when it is
 * true `text` lists what to show the reviewer (per-file rises, accepted rises and the section).
 * `hint` says how to fix the cause, `acceptRises` are the rule ids named on the command line.
 */
export function guardRatchetUpdate({ root, path, next, acceptRises = [], hint = '', label }) {
  if (!isBaselinePath(path)) {
    throw new Error(
      `[${label}] refusing to guard ${path}: a baseline name must end in ${BASELINE_SUFFIX}.`,
    )
  }
  const prefix = `[${label}]`
  const mergeBase = resolveMergeBase(root)
  let before
  let after
  try {
    after = typeof next === 'string' ? JSON.parse(next) : next
    assertRatchetShape(path, 'the update', after)
    before = readBaselineAt(root, mergeBase.rev, path)
  } catch (error) {
    return { ok: false, text: `${error.message}\n` }
  }
  const entries = entriesFor(path, before, after)
  const lines = []
  const fileRises = before ? perFileRises(before, after) : []
  if (entries.length > 0 || fileRises.length > 0 || acceptRises.length > 0) {
    lines.push(`${prefix} compared with ${mergeBase.label}.`)
    if (mergeBase.hint) {
      lines.push(`${prefix} ${mergeBase.hint}`)
    }
  }
  for (const { rule, file, from, to } of fileRises) {
    lines.push(`${prefix} rise: ${file} [${rule}] ${from} -> ${to}`)
  }
  const accepted = new Set(acceptRises)
  const needed = new Set(entries.map(entry => entry.rule))
  const unaccepted = entries.filter(entry => !accepted.has(entry.rule))
  const unused = [...accepted].filter(rule => !needed.has(rule)).sort()
  if (unaccepted.length === 0 && unused.length === 0) {
    if (entries.length > 0) {
      lines.push(
        ...entries.map(entry => `${prefix} accepted ${describeEntry(entry)}`),
        'Add this to the pull request description (the description check fails without it):',
        '',
        formatRiseSection(entries).trimEnd(),
      )
    }
    return { ok: true, text: lines.length > 0 ? `${lines.join('\n')}\n` : '' }
  }
  for (const entry of unaccepted) {
    lines.push(`${prefix} ${describeEntry(entry)}`)
  }
  for (const rule of unused) {
    lines.push(
      `${prefix} ${ACCEPT_RISE_FLAG} ${rule}: this rule neither rises nor retires against ${mergeBase.label}. Remove the flag.`,
    )
  }
  if (unaccepted.length > 0) {
    const raising = unaccepted.some(entry => entry.to !== null)
    const flags = unaccepted.map(entry => `${ACCEPT_RISE_FLAG} ${entry.rule}`).join(' ')
    lines.push(
      `${raising ? 'Refusing to raise the baseline.' : 'Refusing to retire a rule from the baseline.'}${hint ? ` ${hint}` : ''}`,
      `If the change is intended, rerun with ${flags} and add this to the`,
      'pull request description (the description check fails without it):',
      '',
      formatRiseSection(entries).trimEnd(),
    )
  }
  return { ok: false, text: `${lines.join('\n')}\n` }
}
