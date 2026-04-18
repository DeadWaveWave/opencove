import type { Terminal } from '@xterm/xterm'

export async function writeTerminalAsync(terminal: Terminal, data: string): Promise<void> {
  if (data.length === 0) {
    return
  }

  await new Promise<void>(resolve => {
    terminal.write(data, () => {
      resolve()
    })
  })
}
