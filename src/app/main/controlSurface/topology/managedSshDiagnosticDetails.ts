import { stripVTControlCharacters } from 'node:util'

export function managedSshDiagnosticDetails(
  values: Array<string | null | undefined>,
  token?: string,
): string[] {
  const details = new Set<string>()
  for (const value of values) {
    for (let line of (value ?? '').split(/\r\n|\r|\n/)) {
      if (line.includes('[opencove-bootstrap-progress:')) {
        continue
      }
      line = stripVTControlCharacters(line)
        .replace(/\p{Cc}/gu, '')
        .trim()
      if (token) {
        line = line.replaceAll(token, '[redacted]')
      }
      line = line.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
      line = line.replace(/((?:--token|password|authorization)\s*[=:]\s*)\S+/gi, '$1[redacted]')
      line = line.replace(
        /^channel \d+: (open failed: connect failed: Connection refused)$/i,
        'SSH channel: $1',
      )
      if (line) {
        details.add(line.length <= 320 ? line : `${line.slice(0, 319)}…`)
      }
      if (details.size >= 3) {
        return [...details]
      }
    }
  }
  return [...details]
}
