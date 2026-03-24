import os from 'node:os'
import process from 'node:process'

export function resolveDefaultShell(): string {
  if (process.platform === 'win32') {
    return 'powershell.exe'
  }

  return process.env.SHELL || (os.platform() === 'darwin' ? '/bin/zsh' : '/bin/bash')
}
