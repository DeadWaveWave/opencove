import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { TestInfo } from '@playwright/test'

const ANSI_ESCAPE_PATTERN = new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, 'gu')
const CAPTURE_LIMIT = 8_192
const PLAN_FILENAME_LIMIT = 64
const SHIM_CONTENT_SOURCE =
  'src/contexts/agent/infrastructure/terminal-activity/TerminalAgentTelemetryScripts.ts'

// Keep this contract narrow: diagnostics must never receive environment or plan-file contents.
interface WindowsShimFailureDiagnostics {
  command: { executable: string; args: readonly string[]; cwd: string }
  exitCode: number | null
  launcherPath: string
  planDirectory: string
  providerCommand: 'claude' | 'codex'
  ptyOutput?: string
  ptyWrites?: readonly string[]
  shimDirectory: string
  stderr: string
  stdout: string
  streamNote?: string
}

export async function reportWindowsShimFailure(
  testInfo: TestInfo,
  diagnostics: WindowsShimFailureDiagnostics,
): Promise<void> {
  let text: string
  try {
    text = await formatDiagnostics(diagnostics)
  } catch (error) {
    text = `diagnosticFormattingError=${formatValue(describeError(error))}`
  }

  // eslint-disable-next-line no-console -- CI must surface captured stderr in the failed-job log.
  console.error(`[terminal-agent-shim-diagnostics]\n${text}`)
  await testInfo
    .attach('terminal-agent-shim-diagnostics', {
      body: Buffer.from(text, 'utf8'),
      contentType: 'text/plain',
    })
    .catch(error => {
      // eslint-disable-next-line no-console -- Attachment failures must not hide the original assertion.
      console.error(
        `[terminal-agent-shim-diagnostics] attachmentError=${formatValue(describeError(error))}`,
      )
    })
}

async function formatDiagnostics(diagnostics: WindowsShimFailureDiagnostics): Promise<string> {
  const cmdPath = join(diagnostics.shimDirectory, `${diagnostics.providerCommand}.cmd`)
  const powerShellPath = join(diagnostics.shimDirectory, `${diagnostics.providerCommand}.ps1`)
  const [cmdContent, powerShellContent, planListing] = await Promise.all([
    readBoundedFile(cmdPath),
    readBoundedFile(powerShellPath),
    readPlanListing(diagnostics.planDirectory),
  ])

  return [
    `command.executable=${formatValue(diagnostics.command.executable)}`,
    `command.args=${formatValue(JSON.stringify(diagnostics.command.args))}`,
    `command.cwd=${formatValue(diagnostics.command.cwd)}`,
    `exitCode=${String(diagnostics.exitCode)}`,
    `normalizedStdout=${formatValue(normalizeOutput(diagnostics.stdout))}`,
    `normalizedStderr=${formatValue(normalizeOutput(diagnostics.stderr))}`,
    ...(diagnostics.streamNote ? [`streamNote=${formatValue(diagnostics.streamNote)}`] : []),
    ...(diagnostics.ptyWrites
      ? [`ptyWrites=${formatValue(JSON.stringify(diagnostics.ptyWrites))}`]
      : []),
    ...(diagnostics.ptyOutput !== undefined
      ? [`normalizedPtyOutput=${formatValue(normalizeOutput(diagnostics.ptyOutput))}`]
      : []),
    `generatedShimContentSource=${formatValue(SHIM_CONTENT_SOURCE)}`,
    `generatedCmdShim.path=${formatValue(cmdPath)}`,
    `generatedCmdShim.content=${formatValue(cmdContent)}`,
    `generatedPowerShellShim.path=${formatValue(powerShellPath)}`,
    `generatedPowerShellShim.content=${formatValue(powerShellContent)}`,
    `launcher.path=${formatValue(diagnostics.launcherPath)}`,
    `planDirectory.path=${formatValue(diagnostics.planDirectory)}`,
    `planDirectory.filenames=${formatValue(JSON.stringify(planListing.filenames))}`,
    `planDirectory.totalEntries=${String(planListing.totalEntries)}`,
  ].join('\n')
}

async function readBoundedFile(path: string): Promise<string> {
  try {
    return bound(await readFile(path, 'utf8'))
  } catch (error) {
    return `<read failed: ${describeError(error)}>`
  }
}

async function readPlanListing(
  path: string,
): Promise<{ filenames: string[]; totalEntries: number }> {
  try {
    const entries = (await readdir(path)).sort()
    return {
      filenames: entries.slice(0, PLAN_FILENAME_LIMIT).map(name => bound(name)),
      totalEntries: entries.length,
    }
  } catch (error) {
    return { filenames: [`<listing failed: ${describeError(error)}>`], totalEntries: 0 }
  }
}

function normalizeOutput(value: string): string {
  return value.replaceAll(ANSI_ESCAPE_PATTERN, '').replaceAll('\r\n', '\n').replaceAll('\r', '\n')
}

function formatValue(value: string): string {
  return JSON.stringify(bound(value))
}

function bound(value: string): string {
  if (value.length <= CAPTURE_LIMIT) {
    return value
  }
  return `${value.slice(0, CAPTURE_LIMIT)}\n<truncated ${String(value.length - CAPTURE_LIMIT)} chars>`
}

function describeError(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error)
}
