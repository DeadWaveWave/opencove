import type { ElectronApplication } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline'

/** Observe the real main-process shell boundary without polling the Node inspector. */
export async function captureSystemOpenPaths(app: ElectronApplication): Promise<{
  read: () => string[]
  dispose: () => void
}> {
  const stdout = app.process().stdout
  if (!stdout) {
    throw new Error('Electron stdout is required to observe system opening')
  }
  const prefix = `opencove-system-open:${randomUUID()}:`
  const paths: string[] = []
  const lines = createInterface({ input: stdout })
  const dispose = (): void => {
    lines.close()
    // readline.close() pauses its input; keep draining Electron during teardown.
    stdout.resume()
  }
  lines.on('line', line => {
    const start = line.indexOf(prefix)
    if (start !== -1) {
      paths.push(JSON.parse(line.slice(start + prefix.length)) as string)
    }
  })
  try {
    await app.evaluate(({ shell }, marker) => {
      shell.openPath = async target => {
        process.stdout.write(`${marker}${JSON.stringify(target)}\n`)
        return ''
      }
    }, prefix)
  } catch (error) {
    dispose()
    throw error
  }
  return { read: () => [...paths], dispose }
}
