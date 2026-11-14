#!/usr/bin/env node
// Prints the `## 📈 Ratchet rises` section the pull request description needs for the working
// tree, compared with the merge base with origin/main. The section goes to stdout, everything
// else to stderr, so the output can be pasted as is.
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { formatRiseSection } from './lib/ratchet.mjs'
import {
  MAIN_REF,
  WORKING_TREE,
  collectRatchetRises,
  resolveMergeBase,
} from './lib/ratchet-git.mjs'

const DEFAULT_REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const LABEL = '[ratchet-rises]'

export function runRatchetRises({
  root = DEFAULT_REPO_ROOT,
  stdout = process.stdout,
  stderr = process.stderr,
} = {}) {
  const mergeBase = resolveMergeBase(root, MAIN_REF, 'HEAD')
  let entries
  try {
    entries = collectRatchetRises(root, mergeBase.rev, WORKING_TREE)
  } catch (error) {
    stderr.write(`${error.message}\n`)
    return 1
  }
  stderr.write(`${LABEL} compared the working tree with ${mergeBase.label}.\n`)
  if (mergeBase.hint) {
    stderr.write(`${LABEL} ${mergeBase.hint}\n`)
  }
  if (entries.length === 0) {
    stderr.write(`${LABEL} no rise or retirement: the pull request needs no section.\n`)
    return 0
  }
  stdout.write(formatRiseSection(entries))
  return 0
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null
if (invokedPath === import.meta.url) {
  process.exitCode = runRatchetRises()
}
