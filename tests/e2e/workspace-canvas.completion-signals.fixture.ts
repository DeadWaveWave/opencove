import { pathToFileURL } from 'node:url'

export const START_COMPLETION_REPAINT = '<test-start-completion-repaint>'

export function createCompletionSignalsStubScript(stubScriptPath: string): string {
  return `
let repaintTimer
let input = ''
const startRepaint = ${JSON.stringify(START_COMPLETION_REPAINT)}
const onData = chunk => {
  input += chunk.toString()
  if (input.includes(startRepaint)) {
    process.stdin.off('data', onData)
    repaintTimer = setInterval(() => process.stdout.write('\\r\\x1b[2K| working 00:01'), 80)
    repaintTimer.unref()
  }
  input = input.slice(-startRepaint.length)
}
process.stdin.on('data', onData)
try {
  await import(${JSON.stringify(pathToFileURL(stubScriptPath).href)})
} catch (error) {
  process.stderr.write('\\n[opencove-completion-stub] failed: ' + (error?.stack ?? error) + '\\n')
  process.exitCode = 1
} finally {
  clearInterval(repaintTimer)
  process.stdin.off('data', onData)
  process.stdin.pause()
}
`
}
