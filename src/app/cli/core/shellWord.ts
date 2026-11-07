/** Encode one literal argument for POSIX shells, including $, redirects and whitespace. */
export function shellWord(value: string): string {
  return /^[a-zA-Z0-9_.,:/=-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"
}
