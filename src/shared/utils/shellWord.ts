/** Encode a POSIX literal; quote @self for PowerShell's splatting syntax as well. */
export function shellWord(value: string): string {
  if (value === '@self') {
    return '"@self"'
  }
  return /^[a-zA-Z0-9_.,:/=-]+$/.test(value) ? value : "'" + value.replaceAll("'", "'\\''") + "'"
}
