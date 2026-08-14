export interface ShellCommandFinishedMarker {
  exitCode: number | null
}

export function resolveShellCommandFinishedMarker(data: string): ShellCommandFinishedMarker | null {
  const escape = String.fromCharCode(27)
  const bell = String.fromCharCode(7)
  const marker = `${escape}]133;D`
  const markerIndex = data.indexOf(marker)
  if (markerIndex < 0) {
    return null
  }

  const tail = data.slice(markerIndex + marker.length)
  const terminatorIndexes = [tail.indexOf(bell), tail.indexOf(`${escape}\\`)].filter(
    index => index >= 0,
  )
  if (terminatorIndexes.length === 0) {
    return null
  }

  const payload = tail.slice(0, Math.min(...terminatorIndexes))
  if (!/^;-?\d+$/u.test(payload)) {
    return { exitCode: null }
  }

  return {
    exitCode: Number(payload.slice(1)),
  }
}
