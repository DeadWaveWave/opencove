// Version arithmetic and registry validation for the compatibility expiry check. Expiry is
// computed only from `package.json` and the registry, so a commit always gives the same verdict.

export const COMPAT_KINDS = [
  'user-data',
  'machine-residue',
  'peer-version',
  'wire',
  'third-party',
  'kill-switch',
]

const VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function parseVersion(value) {
  const match = typeof value === 'string' ? VERSION_PATTERN.exec(value) : null
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

export function compareVersions(left, right) {
  const a = parseVersion(left)
  const b = parseVersion(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) {
      return a[index] < b[index] ? -1 : 1
    }
  }
  return 0
}

export function nextMinorVersion(version, count = 1) {
  const [major, minor] = parseVersion(version)
  return `${major}.${minor + count}.0`
}

// A far-future `until` would silence an entry, so it may reach at most this many minors ahead.
export const MAX_UNTIL_MINOR_DISTANCE = 3

function isFilled(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function checkVersionField(issues, rule, where, value, id) {
  if (parseVersion(value) === null) {
    issues.push({
      rule,
      id,
      message: `${where} must be a version like "0.7.0" (got ${JSON.stringify(value)}).`,
    })
    return false
  }
  return true
}

// Shape of the registry (rule d). Returns the entries that are well-formed enough to evaluate.
export function validateRegistry(registry, issues, baseVersion) {
  const support = registry?.upgradeSupport
  const entries = registry?.entries
  if (!support || typeof support !== 'object' || !entries || typeof entries !== 'object') {
    issues.push({
      rule: 'registry-shape',
      message: 'The registry needs an `upgradeSupport` object and an `entries` object.',
    })
    return { support: null, entries: {} }
  }
  const supportOk =
    checkVersionField(issues, 'invalid-version', 'upgradeSupport.floor', support.floor) &&
    checkVersionField(issues, 'invalid-version', 'upgradeSupport.reviewBy', support.reviewBy)
  if (!isFilled(support.decidedIn)) {
    issues.push({ rule: 'missing-field', message: 'upgradeSupport.decidedIn is missing or empty.' })
  }
  if (supportOk && compareVersions(support.floor, support.reviewBy) >= 0) {
    issues.push({
      rule: 'invalid-version',
      message: `upgradeSupport.floor ${support.floor} must be lower than reviewBy ${support.reviewBy}.`,
    })
  }

  const valid = {}
  for (const [id, entry] of Object.entries(entries)) {
    const where = `entry \`${id}\``
    let ok = true
    if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) {
      issues.push({ rule: 'invalid-id', id, message: `${where} is not a lowercase kebab-case id.` })
      ok = false
    }
    if (!COMPAT_KINDS.includes(entry?.kind)) {
      issues.push({
        rule: 'invalid-kind',
        id,
        message: `${where} has kind ${JSON.stringify(entry?.kind)}; use one of ${COMPAT_KINDS.join(', ')}.`,
      })
      ok = false
    }
    for (const field of ['reason', 'decidedIn']) {
      if (!isFilled(entry?.[field])) {
        issues.push({
          rule: 'missing-field',
          id,
          message: `${where} has a missing or empty \`${field}\`.`,
        })
        ok = false
      }
    }
    const expires = entry?.expires
    const keys = expires && typeof expires === 'object' ? Object.keys(expires) : []
    if (keys.length !== 1 || !['until', 'dataBefore'].includes(keys[0])) {
      issues.push({
        rule: 'invalid-expiry',
        id,
        message: `${where} needs \`expires\` with exactly one of \`until\` or \`dataBefore\`; "never" is not allowed.`,
      })
      ok = false
    } else if (
      !checkVersionField(
        issues,
        'invalid-version',
        `${where} expires.${keys[0]}`,
        expires[keys[0]],
        id,
      )
    ) {
      ok = false
    }
    if (ok && expires.until !== undefined) {
      const latest = nextMinorVersion(baseVersion, MAX_UNTIL_MINOR_DISTANCE)
      if (compareVersions(expires.until, latest) > 0) {
        issues.push({
          rule: 'invalid-expiry',
          id,
          message: `${where} expires at ${expires.until}, more than ${MAX_UNTIL_MINOR_DISTANCE} minor versions after ${baseVersion} (latest allowed ${latest}).`,
        })
        ok = false
      }
    }
    if (ok) {
      valid[id] = entry
    }
  }
  return { support: supportOk ? support : null, entries: valid }
}

// Expiry (rule a). `current` is the evaluated package version; `dataBefore` is judged against the floor.
export function findExpired({ support, entries, current }) {
  const issues = []
  if (support && compareVersions(current, support.reviewBy) >= 0) {
    issues.push({
      rule: 'expired',
      message: `upgradeSupport.reviewBy ${support.reviewBy} has been reached at ${current}: review the floor ${support.floor} and set a new reviewBy.`,
    })
  }
  for (const [id, entry] of Object.entries(entries)) {
    const { until, dataBefore } = entry.expires
    if (until !== undefined && compareVersions(current, until) >= 0) {
      issues.push({
        rule: 'expired',
        id,
        message: `entry \`${id}\` expires at ${until} and the version is ${current}: delete the path or renew the entry with a new reason and \`decidedIn\`.`,
      })
    }
    if (dataBefore !== undefined && support && compareVersions(support.floor, dataBefore) >= 0) {
      issues.push({
        rule: 'expired',
        id,
        message: `entry \`${id}\` covers data written before ${dataBefore} but the upgrade floor is ${support.floor}: delete the path or renew the entry.`,
      })
    }
  }
  return issues
}
