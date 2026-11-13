const MAX_RESULT_LINES = 500

/** Keep generated findings within the same line budget as authored files. */
export function createResultFiles(filename, violations) {
  if (violations.length <= MAX_RESULT_LINES) {
    return [{ filename, violations }]
  }
  const byOwner = new Map()
  for (const violation of violations) {
    const owner = violation.file.split('/').slice(0, 3).join('-')
    const rows = byOwner.get(owner) ?? []
    rows.push(violation)
    byOwner.set(owner, rows)
  }
  return [...byOwner.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([owner, rows]) => {
      const stem = filename.replace(/\.jsonl$/, '')
      const files = []
      for (let offset = 0; offset < rows.length; offset += MAX_RESULT_LINES) {
        const suffix = rows.length > MAX_RESULT_LINES ? `.${offset / MAX_RESULT_LINES + 1}` : ''
        files.push({
          filename: `${stem}.${owner}${suffix}.jsonl`,
          violations: rows.slice(offset, offset + MAX_RESULT_LINES),
        })
      }
      return files
    })
}
