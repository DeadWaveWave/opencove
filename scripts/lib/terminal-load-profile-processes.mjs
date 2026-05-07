import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

async function readWindowsProcessRows() {
  if (process.platform !== 'win32') {
    return []
  }

  const command = [
    'Get-CimInstance Win32_Process |',
    'Select-Object ProcessId,ParentProcessId,Name,CommandLine,WorkingSetSize,PrivatePageCount,UserModeTime,KernelModeTime,ThreadCount |',
    'ConvertTo-Json -Compress',
  ].join(' ')
  const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-Command', command], {
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  })
  const parsed = JSON.parse(stdout || '[]')
  return Array.isArray(parsed) ? parsed : [parsed]
}

function collectDescendants(rows, rootPid) {
  const byParent = new Map()
  for (const row of rows) {
    const parentId = Number(row.ParentProcessId)
    const list = byParent.get(parentId) ?? []
    list.push(row)
    byParent.set(parentId, list)
  }

  const result = []
  const stack = [Number(rootPid)]
  const seen = new Set(stack)

  while (stack.length > 0) {
    const current = stack.pop()
    for (const child of byParent.get(current) ?? []) {
      const pid = Number(child.ProcessId)
      if (!Number.isFinite(pid) || seen.has(pid)) {
        continue
      }
      seen.add(pid)
      result.push(child)
      stack.push(pid)
    }
  }

  const root = rows.find(row => Number(row.ProcessId) === Number(rootPid))
  if (root) {
    result.unshift(root)
  }

  return result
}

function classifyProcess(row) {
  const commandLine = String(row.CommandLine ?? '').toLowerCase()
  const name = String(row.Name ?? '').toLowerCase()
  if (commandLine.includes('profile-terminal-output-stub.mjs')) {
    return 'external-output-stub'
  }
  if (name === 'codex.exe' || name === 'codex' || commandLine.includes('\\codex')) {
    return 'external-agent-codex'
  }
  if (name === 'claude.exe' || name === 'claude' || commandLine.includes('\\claude')) {
    return 'external-agent-claude'
  }
  if (name === 'conhost.exe' || name === 'openconsole.exe') {
    return 'windows-console-host'
  }
  if (
    name === 'powershell.exe' ||
    name === 'pwsh.exe' ||
    name === 'cmd.exe' ||
    name === 'bash.exe' ||
    name === 'zsh'
  ) {
    return 'external-shell'
  }
  if (commandLine.includes('ptyhost') || commandLine.includes('ptyhost.js')) {
    return 'opencove-pty-host'
  }
  if (commandLine.includes('worker.js')) {
    return 'opencove-worker'
  }
  if (commandLine.includes('--type=renderer')) {
    return 'electron-renderer'
  }
  if (commandLine.includes('--type=utility')) {
    return 'electron-utility'
  }
  if (name.includes('electron')) {
    return 'electron-main-or-browser'
  }
  if (name === 'node.exe' || name === 'node') {
    return 'node-child'
  }
  return 'other'
}

export async function readProcessSample(rootPid) {
  const rows = collectDescendants(await readWindowsProcessRows(), rootPid)
  return rows.map(row => ({
    pid: Number(row.ProcessId),
    parentPid: Number(row.ParentProcessId),
    name: row.Name,
    kind: classifyProcess(row),
    workingSetBytes: Number(row.WorkingSetSize ?? 0),
    privateBytes: Number(row.PrivatePageCount ?? 0),
    userTime100ns: Number(row.UserModeTime ?? 0),
    kernelTime100ns: Number(row.KernelModeTime ?? 0),
    threadCount: Number(row.ThreadCount ?? 0),
    commandLine: String(row.CommandLine ?? ''),
  }))
}

export function summarizeProcessSample(rows) {
  const byKind = new Map()
  for (const row of rows) {
    const item = byKind.get(row.kind) ?? {
      kind: row.kind,
      count: 0,
      workingSetBytes: 0,
      privateBytes: 0,
      threadCount: 0,
    }
    item.count += 1
    item.workingSetBytes += row.workingSetBytes
    item.privateBytes += row.privateBytes
    item.threadCount += row.threadCount
    byKind.set(row.kind, item)
  }
  return [...byKind.values()].sort((a, b) => a.kind.localeCompare(b.kind))
}
