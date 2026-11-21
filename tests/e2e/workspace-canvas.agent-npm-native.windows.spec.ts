import { copyFile, mkdir, mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import { expect, test } from '@playwright/test'
import { clearAndSeedWorkspace, launchApp, removePathWithRetry } from './workspace-canvas.helpers'
import { compileWindowsFixture } from './fixtures/create-native-hook-provider'

async function readReceiverFile(path: string): Promise<string> {
  return await readFile(path, 'utf8').catch(error => {
    if (error.code === 'ENOENT') {
      return ''
    }
    throw error
  })
}

test('New Agent dock button starts npm-installed Claude Code in a live PowerShell PTY', async () => {
  test.skip(process.platform !== 'win32', 'Windows npm wrapper and ConPTY')
  const root = await mkdtemp(join(tmpdir(), 'OpenCove Claude npm '))
  const output = join(root, 'argv.txt')
  let app: Awaited<ReturnType<typeof launchApp>> | undefined
  try {
    // Use the actual npm/cmd-shim templates and Claude's package layout, without
    // executing npm or Claude, reading a user config, or contacting a provider.
    const executable = join(
      root,
      'node_modules',
      '@anthropic-ai',
      'claude-code',
      'bin',
      'claude.exe',
    )
    await mkdir(dirname(executable), { recursive: true })
    compileWindowsFixture(resolve('tests/support/windowsArgvReceiver.cs'), executable)
    for (const ext of ['cmd', 'ps1']) {
      await copyFile(`tests/fixtures/windows-argv/npm-native.${ext}`, join(root, `claude.${ext}`))
    }

    const pathKey = Object.keys(process.env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    app = await launchApp({
      env: {
        [pathKey]: [root, process.env[pathKey] ?? ''].join(delimiter),
        OPENCOVE_ARGV_RECEIVER_OUTPUT: output,
        OPENCOVE_ARGV_RECEIVER_INTERACTIVE: '1',
        OPENCOVE_TEST_USE_REAL_AGENTS: '1',
        OPENCOVE_WORKER_CLIENT: '0',
      },
    })
    const { window } = app
    await clearAndSeedWorkspace(window, [], {
      settings: { defaultProvider: 'claude-code', defaultTerminalProfileId: 'powershell' },
    })

    await window.getByTestId('workspace-canvas-action-bar-new-agent').click()
    const node = window.locator('.terminal-node')
    await expect(node).toHaveCount(1)
    await expect
      .poll(() => readReceiverFile(output + '.transport'), { timeout: 20_000 })
      .toBe('absent,absent,absent')
    await expect.poll(() => readReceiverFile(output + '.tty')).toBe('True')
    const input = node.locator('.xterm-helper-textarea')
    await input.focus()
    await window.keyboard.type('native shortcut input')
    await window.keyboard.press('Enter')
    await expect.poll(() => readReceiverFile(output + '.input')).toBe('native shortcut input')
  } finally {
    try {
      await app?.electronApp.close()
    } finally {
      await removePathWithRetry(root)
    }
  }
})
