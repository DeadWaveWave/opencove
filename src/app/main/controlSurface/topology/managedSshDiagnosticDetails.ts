import { stripVTControlCharacters } from 'node:util'

export function redactManagedSshOutput(value: string, token?: string): string {
  let text = token ? value.replaceAll(token, '[redacted]') : value
  text = text.replace(
    /("(?:token|password|authorization|webUiPassword)"\s*:\s*)"(?:\\.|[^"\\])*"/gi,
    '$1"[redacted]"',
  )
  text = text.replace(/(\bBearer\s+)[^\s"'<>]+/gi, '$1[redacted]')
  text = text.replace(/([?&](?:token|password|access_token)=)[^\s&#"']*/gi, '$1[redacted]')
  text = text.replace(/((?:--token|password|authorization)\s*[=:]\s*)\S+/gi, '$1[redacted]')
  return text.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[redacted]@')
}

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
      line = redactManagedSshOutput(line, token)
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
