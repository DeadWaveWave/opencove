// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { readFile, mkdtemp, rm, access, writeFile, copyFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { expect, it } from 'vitest'
import { TerminalProfileResolver } from '../../../src/platform/terminal/TerminalProfileResolver'
import { serializeWindowsArguments } from '../../../src/platform/process/windowsCommandLine'
import { compileWindowsFixture } from '../../e2e/fixtures/create-native-hook-provider'

const native = process.platform === 'win32' ? it : it.skip
const vectors = [
  'update',
  'plugins',
  ' --agent-teams ',
  '$(printf update)',
  '"update"',
  '"plugins"',
  '" --agent-teams "',
  'Explain " --agent-teams " please',
  '',
  'a\tb\r\nc',
  '中文 😀',
  'a\\"b',
  'C:\\folder with space\\',
  '%PATH% & ^ ! `',
]
async function powershellPath(name: string): Promise<string | null> {
  try {
    return execFileSync('where.exe', [name], { encoding: 'utf8' }).trim().split(/\r?\n/)[0]
  } catch {
    return null
  }
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'opencove-native-argv-'))
  return {
    root,
    executable: compileWindowsFixture(
      join(process.cwd(), 'tests/support/windowsArgvReceiver.cs'),
      join(root, 'receiver.exe'),
    ),
    output: join(root, 'argv.txt'),
  }
}
async function launch(
  root: string,
  executable: string,
  output: string,
  shell: string,
  mode: string,
  interactive = false,
) {
  const resolver = new TerminalProfileResolver({
    platform: 'win32',
    locateWindowsCommands: async names => (names.includes('powershell.exe') ? [shell] : []),
    listWslDistros: async () => [],
  })
  const spawn = await resolver.resolveCommandSpawn({
    cwd: root,
    profileId: 'powershell',
    command: executable,
    args: [...vectors],
    env: {
      OPENCOVE_ARGV_RECEIVER_OUTPUT: output,
      OPENCOVE_ARGV_RECEIVER_INTERACTIVE: interactive ? '1' : '0',
    },
  })
  // Isolate this fixture from the user's profile. Only the binder-mode prelude is added;
  // the real resolver's complete encoded launcher and final node-pty transport are retained.
  const script =
    `$PSNativeCommandArgumentPassing = '${mode}'\n` +
    Buffer.from(spawn.args[2], 'base64').toString('utf16le')
  const args = [
    '-NoProfile',
    ...spawn.args.slice(0, 2),
    Buffer.from(script, 'utf16le').toString('base64'),
  ]
  const { spawn: spawnPty } = await import('node-pty')
  const pty = spawnPty(spawn.command, serializeWindowsArguments(args), {
    cwd: spawn.cwd,
    env: spawn.env as Record<string, string>,
    cols: 200,
    rows: 30,
    name: 'xterm-256color',
  })
  pty.onData(() => {})
  let exited = false
  const exit = new Promise<number>(resolve =>
    pty.onExit(event => {
      exited = true
      resolve(event.exitCode)
    }),
  )
  return {
    pty,
    exit,
    dispose: () => {
      if (!exited) {
        pty.kill()
      }
    },
  }
}
for (const [name, mode] of [
  ['powershell.exe', 'Legacy'],
  ['pwsh.exe', 'Legacy'],
  ['pwsh.exe', 'Standard'],
]) {
  native(
    `${name}/${mode} preserves native receiver argv, exit code and npm shim forwarding`,
    async () => {
      const shell = await powershellPath(name)
      if (!shell) {
        throw new Error(`Install ${name} to verify this required platform mode`)
      }
      const f = await fixture()
      let child: Awaited<ReturnType<typeof launch>> | undefined
      try {
        child = await launch(f.root, f.executable, f.output, shell, mode)
        expect(await child.exit).toBe(37)
        expect(await readFile(f.output + '.transport', 'utf8')).toBe('absent,absent,absent')
        expect(
          (await readFile(f.output, 'utf8'))
            .trimEnd()
            .split(/\r?\n/)
            .map(value => Buffer.from(value, 'base64').toString('utf8')),
        ).toEqual(vectors)
        // A real standard npm .cmd is never evaluated by cmd.exe: its Node entrypoint is native.
        const shim = join(f.root, 'provider.cmd')
        await copyFile('tests/fixtures/windows-argv/npm-node.cmd', shim)
        await copyFile(f.executable, join(f.root, 'node.exe'))
        const entry = join(f.root, 'node_modules', 'provider', 'cli.js')
        const { mkdir } = await import('node:fs/promises')
        await mkdir(dirname(entry), { recursive: true })
        await writeFile(entry, 'inert fixture')
        child = await launch(f.root, shim, f.output, shell, mode)
        expect(await child.exit).toBe(37)
        expect(
          (await readFile(f.output, 'utf8'))
            .trimEnd()
            .split(/\r?\n/)
            .map(value => Buffer.from(value, 'base64').toString('utf8')),
        ).toEqual([entry, ...vectors])
        const ps1 = join(f.root, 'provider.ps1')
        await copyFile('tests/fixtures/windows-argv/npm-node.ps1', ps1)
        child = await launch(f.root, ps1, f.output, shell, mode)
        expect(await child.exit).toBe(37)
        expect(
          (await readFile(f.output, 'utf8'))
            .trimEnd()
            .split(/\r?\n/)
            .map(value => Buffer.from(value, 'base64').toString('utf8')),
        ).toEqual([entry, ...vectors])
        await writeFile(shim, 'echo unsafe\r\n' + (await readFile(shim, 'utf8')))
        await rm(f.output)
        child = await launch(f.root, shim, f.output, shell, mode)
        expect(await child.exit).not.toBe(37)
        await expect(access(f.output)).rejects.toThrow()
      } finally {
        child?.dispose()
        await rm(f.root, { recursive: true, force: true })
      }
    },
    30_000,
  )
}
native(
  'native child keeps its ConPTY handles, accepts input and receives Ctrl+C',
  async () => {
    const shell = (await powershellPath('powershell.exe'))!
    const f = await fixture()
    let child: Awaited<ReturnType<typeof launch>> | undefined
    try {
      child = await launch(f.root, f.executable, f.output, shell, 'Legacy', true)
      await expect.poll(() => readFile(f.output + '.tty', 'utf8')).toBe('True')
      child.pty.write('hello native\r')
      await expect.poll(() => readFile(f.output + '.input', 'utf8')).toBe('hello native')
      child.pty.write('\x03')
      await expect.poll(() => readFile(f.output + '.signal', 'utf8')).toBe('Ctrl+C')
      expect(await child.exit).toBe(37)
    } finally {
      child?.dispose()
      await rm(f.root, { recursive: true, force: true })
    }
  },
  30_000,
)

it.runIf(process.platform === 'win32' && Boolean(process.env.OPENCOVE_TEST_WSL_DISTRO))(
  'WSL --exec delivers exact argv and env to an inert guest receiver',
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'opencove-wsl-argv-'))
    const output = join(root, 'argv.json')
    let child: import('node-pty').IPty | undefined
    let exited = false
    try {
      const distro = process.env.OPENCOVE_TEST_WSL_DISTRO!
      const { convertWindowsPathToWslPath } =
        await import('../../../src/platform/terminal/TerminalProfileResolver.windows')
      const guestOutput = convertWindowsPathToWslPath(output, distro)!
      const resolver = new TerminalProfileResolver({
        platform: 'win32',
        listWslDistros: async () => [distro],
        locateWindowsCommands: async () => [],
      })
      const script =
        'import sys,json,os;open(sys.argv[1],"w",encoding="utf-8").write(json.dumps({"args":sys.argv[2:],"env":os.environ.get("FIXTURE")},ensure_ascii=False))'
      const spawn = await resolver.resolveCommandSpawn({
        cwd: root,
        profileId: `wsl:${distro}`,
        command: '/usr/bin/python3',
        args: ['-c', script, guestOutput, ...vectors],
        commandEnv: { FIXTURE: '"env with spaces"' },
      })
      const { spawn: spawnPty } = await import('node-pty')
      child = spawnPty(spawn.command, serializeWindowsArguments(spawn.args), {
        cwd: spawn.cwd,
        env: spawn.env as Record<string, string>,
        cols: 200,
        rows: 30,
      })
      child.onData(() => {})
      const exit = await new Promise<number>(resolve =>
        child!.onExit(event => {
          exited = true
          resolve(event.exitCode)
        }),
      )
      expect(exit).toBe(0)
      expect(JSON.parse(await readFile(output, 'utf8'))).toEqual({
        args: vectors,
        env: '"env with spaces"',
      })
    } finally {
      if (!exited) {
        child?.kill()
      }
      await rm(root, { recursive: true, force: true })
    }
  },
  30_000,
)
