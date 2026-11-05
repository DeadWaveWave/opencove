export async function recoveredTerminalHasFreshOutput({
  nodeId,
  sessionId,
  marker,
}: {
  nodeId: string
  sessionId: string
  marker: string
}): Promise<boolean> {
  const api = window.__opencoveTerminalSelectionTestApi!
  const snapshot = await window.opencoveApi.pty.presentationSnapshot({ sessionId })
  const grid = api.getSize(nodeId)
  const proposed = api.getProposedGeometry(nodeId)
  const output = `${marker}_INPUT_OK`
  // ConPTY can leave stale cells after the output or soft-wrap it across rows.
  // Search logical lines for the shell-assembled token, which is absent from the command echo.
  const buffer = api.getBufferText(nodeId, output)
  return (
    buffer !== null &&
    buffer.markerAbsoluteLine !== null &&
    snapshot.serializedScreen.includes(output) &&
    grid?.cols === snapshot.cols &&
    grid?.rows === snapshot.rows &&
    grid?.cols === proposed?.cols &&
    grid?.rows === proposed?.rows
  )
}
