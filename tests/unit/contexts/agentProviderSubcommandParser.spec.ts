// @vitest-environment node
import { createRequire } from 'node:module'
import { readFile, access } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { runInNewContext } from 'node:vm'
import { expect, it } from 'vitest'
import { buildAgentLaunchCommand } from '../../../src/contexts/agent/infrastructure/cli/AgentCommandFactory'
import { PiAgentProviderContribution } from '../../../src/contexts/agent/infrastructure/providers/pi/PiAgentProviderContribution'
import { createManagedAgentLaunchPlan } from '../../../src/contexts/agent/application/use-cases/createManagedAgentLaunchPlan'

// Use the existing toolchain parser. All callbacks below only record dispatch; no provider runs.
interface RecordingCommand {
  name(name: string): this
  argument(argument: string): this
  option(flags: string): this
  command(name: string): RecordingCommand
  action(callback: (prompt?: string) => void): this
  exitOverride(): this
  parse(args: readonly string[], options: { from: 'user' }): this
}
const require = createRequire(import.meta.url)
const { Command } = createRequire(require.resolve('lint-staged'))('commander') as {
  Command: new () => RecordingCommand
}
const words = ['logout', 'update', 'resume', 'Refactor']
function commanderDispatch(args: readonly string[]) {
  let outcome: { command: string; prompt?: string } | undefined
  const parser = new Command()
    .name('fixture')
    .argument('[prompt]')
    .option('--permission-mode <mode>')
    .option('--session-id <id>')
    .exitOverride()
    .action(prompt => {
      outcome = { command: 'conversation', prompt }
    })
  for (const name of ['logout', 'update', 'resume']) {
    parser.command(name).action(() => {
      outcome = { command: name }
    })
  }
  parser.parse(args, { from: 'user' })
  return outcome
}
it.each(words)(
  'records Commander dispatch of %j even after -- without running an action',
  prompt => {
    const plan = buildAgentLaunchCommand({
      provider: 'claude-code',
      mode: 'new',
      prompt,
      model: null,
      resumeSessionId: '11111111-1111-4111-8111-111111111111',
      agentFullAccess: false,
    })
    const expected =
      prompt === 'Refactor' ? { command: 'conversation', prompt } : { command: prompt }
    expect(commanderDispatch(plan.args)).toEqual(expected)
    expect(commanderDispatch([...plan.args.slice(0, -1), '--', prompt])).toEqual(expected)
  },
)
it.each(['update the project', 'resume\nthe task'])(
  'keeps multi-word %j in one Commander operand',
  prompt => {
    expect(commanderDispatch([prompt])).toEqual({ command: 'conversation', prompt })
  },
)

// Opt-in parser-only check against an installed Pi package, never its CLI main/handlers.
// The ordinary adapter suite always covers the same vectors without a local installation.
const piRoot = process.env.OPENCOVE_TEST_PI_PARSER_ROOT
async function piParsers() {
  const source = await readFile(join(piRoot!, 'dist/package-manager-cli.js'), 'utf8')
  const start = source.indexOf('function parsePackageCommand(')
  const end = source.indexOf('\nfunction ', start + 1)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  // Evaluate only this pure parser, without importing package handlers or their IO dependencies.
  const parsePackage = runInNewContext(`(${source.slice(start, end)})`, Object.create(null), {
    timeout: 1000,
  }) as (args: readonly string[]) => { command: string } | undefined
  const argsModule = (await import(
    /* @vite-ignore */ pathToFileURL(join(piRoot!, 'dist/cli/args.js')).href
  )) as {
    parseArgs(args: readonly string[]): {
      fileArgs: string[]
      messages: string[]
      diagnostics: unknown[]
    }
  }
  return { parsePackage, argsModule }
}
it.runIf(piRoot).each(['--continue', '--approve', '-p', '--dangerously-skip-permissions'])(
  'Pi actual parsers keep option-like %j in a file without telemetry or model args',
  async prompt => {
    const { parsePackage, argsModule } = await piParsers()
    const managed = await createManagedAgentLaunchPlan(new PiAgentProviderContribution(), {
      mode: 'new',
      prompt,
      model: null,
      resumeSessionId: null,
      agentFullAccess: false,
      workspaceDirectory: process.cwd(),
    })
    let file: string | undefined
    try {
      expect(managed.plan.args).toHaveLength(1)
      expect(parsePackage(managed.plan.args)).toBeUndefined()
      const parsed = argsModule.parseArgs(managed.plan.args)
      expect(parsed.diagnostics).toEqual([])
      expect(parsed.messages).toEqual([])
      expect(parsed.fileArgs).toHaveLength(1)
      file = parsed.fileArgs[0]
      expect(await readFile(file, 'utf8')).toBe(prompt)
    } finally {
      await managed.artifacts.dispose()
    }
    await expect(access(file!)).rejects.toThrow()
  },
)

// S1d: retain and expose trusted single-word native dispatch; grants reject these upstream.
it.runIf(piRoot).each(words)(
  'records trusted Pi single-word %j behavior without running its action',
  async prompt => {
    const { parsePackage, argsModule } = await piParsers()
    const managed = await createManagedAgentLaunchPlan(new PiAgentProviderContribution(), {
      mode: 'new',
      prompt,
      model: null,
      resumeSessionId: null,
      agentFullAccess: false,
      workspaceDirectory: process.cwd(),
    })
    try {
      expect(managed.plan.args).toEqual([prompt])
      expect(managed.plan.fileArguments).toBeUndefined()
      expect(parsePackage(managed.plan.args)?.command).toBe(
        prompt === 'update' ? 'update' : undefined,
      )
      expect(argsModule.parseArgs(managed.plan.args).messages).toEqual([prompt])
    } finally {
      await managed.artifacts.dispose()
    }
  },
)
