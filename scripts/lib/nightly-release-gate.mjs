import { spawnSync } from 'node:child_process'

function runGitCommand({ args, cwd = process.cwd(), spawnSyncImpl = spawnSync, stdio = 'pipe' }) {
  const result = spawnSyncImpl('git', args, {
    cwd,
    encoding: 'utf8',
    shell: false,
    stdio,
  })

  if (result.error) {
    throw result.error
  }

  return result
}

export function resolveNearestReachableTag({
  targetRef = 'HEAD',
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
} = {}) {
  const result = runGitCommand({
    args: ['describe', '--tags', '--abbrev=0', targetRef],
    cwd,
    spawnSyncImpl,
  })

  if (result.status === 0) {
    return result.stdout.trim() || null
  }

  if (result.status === 128) {
    const stderr = result.stderr?.trim() || ''
    if (
      stderr.includes('No names found') ||
      stderr.includes('No tags can describe') ||
      stderr.includes('No annotated tags can describe')
    ) {
      return null
    }
  }

  const stderr = result.stderr?.trim() || `git describe exited with status ${result.status}.`
  throw new Error(stderr)
}

export function resolveCommitCountSinceTag({
  previousTag,
  targetRef = 'HEAD',
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
}) {
  if (!previousTag) {
    return 0
  }

  const result = runGitCommand({
    args: ['rev-list', '--count', `${previousTag}..${targetRef}`],
    cwd,
    spawnSyncImpl,
  })

  if (result.status !== 0) {
    const stderr = result.stderr?.trim() || `git rev-list exited with status ${result.status}.`
    throw new Error(stderr)
  }

  const commitCount = Number.parseInt(result.stdout.trim(), 10)
  if (!Number.isFinite(commitCount)) {
    throw new Error(`Unable to parse commit count from git rev-list output: ${result.stdout}`)
  }

  return commitCount
}

export function resolveHasChangesSinceTag({
  previousTag,
  targetRef = 'HEAD',
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
}) {
  if (!previousTag) {
    return true
  }

  const result = runGitCommand({
    args: ['diff', '--quiet', previousTag, targetRef],
    cwd,
    spawnSyncImpl,
    stdio: 'ignore',
  })

  if (result.status === 0) {
    return false
  }

  if (result.status === 1) {
    return true
  }

  throw new Error(`git diff exited with status ${result.status}.`)
}

export function resolveNightlyReleaseGate({
  eventName = 'schedule',
  targetRef = 'HEAD',
  cwd = process.cwd(),
  spawnSyncImpl = spawnSync,
} = {}) {
  const previousTag = resolveNearestReachableTag({ targetRef, cwd, spawnSyncImpl })
  const commitCountSinceTag = resolveCommitCountSinceTag({
    previousTag,
    targetRef,
    cwd,
    spawnSyncImpl,
  })
  const hasChanges = resolveHasChangesSinceTag({
    previousTag,
    targetRef,
    cwd,
    spawnSyncImpl,
  })

  const isScheduledRelease = eventName === 'schedule'
  let reason = 'changed_since_tag'

  if (!previousTag) {
    reason = 'no_previous_tag'
  } else if (!hasChanges) {
    reason = isScheduledRelease ? 'no_changes_since_tag' : 'manual_override'
  } else if (!isScheduledRelease) {
    reason = 'manual_override'
  }

  return {
    previousTag,
    commitCountSinceTag,
    hasChanges,
    shouldRelease: isScheduledRelease ? hasChanges : true,
    reason,
  }
}

export function formatNightlyReleaseGateOutput(result) {
  return [
    `previous_tag=${result.previousTag ?? ''}`,
    `commit_count_since_tag=${result.commitCountSinceTag}`,
    `has_changes=${result.hasChanges}`,
    `should_release=${result.shouldRelease}`,
    `reason=${result.reason}`,
  ].join('\n')
}
