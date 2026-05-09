import { describe, expect, it } from 'vitest'
import {
  classifyPerformanceProcess,
  normalizePerformanceProcessRow,
  sanitizeProcessCommandLine,
  summarizePerformanceProcesses,
} from '../../../src/app/main/diagnostics/performanceProcessClassifier'

describe('performance process classifier', () => {
  it('separates OpenCove, external agents, shells, and console hosts', () => {
    expect(
      classifyPerformanceProcess({
        pid: 100,
        mainPid: 100,
        name: 'OpenCove.exe',
        commandLine: 'OpenCove.exe',
      }),
    ).toBe('opencove-main')
    expect(
      classifyPerformanceProcess({
        pid: 101,
        mainPid: 100,
        name: 'OpenCove.exe',
        commandLine: 'OpenCove.exe --type=renderer',
      }),
    ).toBe('opencove-renderer')
    expect(
      classifyPerformanceProcess({
        pid: 102,
        mainPid: 100,
        name: 'node.exe',
        commandLine: 'node.exe out/main/ptyHost/entry.js',
      }),
    ).toBe('opencove-pty-host')
    expect(
      classifyPerformanceProcess({
        pid: 107,
        mainPid: 100,
        name: 'OpenCove.exe',
        commandLine:
          'OpenCove.exe C:/Users/app/resources/app.asar/out/main/worker.js --started-by desktop',
      }),
    ).toBe('opencove-worker')
    expect(
      classifyPerformanceProcess({
        pid: 103,
        mainPid: 100,
        name: 'codex.exe',
        commandLine: 'codex exec',
      }),
    ).toBe('external-agent-codex')
    expect(
      classifyPerformanceProcess({
        pid: 104,
        mainPid: 100,
        name: 'claude.exe',
        commandLine: 'claude --print',
      }),
    ).toBe('external-agent-claude')
    expect(
      classifyPerformanceProcess({
        pid: 105,
        mainPid: 100,
        name: 'pwsh.exe',
        commandLine: 'pwsh.exe -NoLogo',
      }),
    ).toBe('external-shell')
    expect(
      classifyPerformanceProcess({
        pid: 106,
        mainPid: 100,
        name: 'conhost.exe',
        commandLine: 'conhost.exe',
      }),
    ).toBe('windows-console-host')
  })

  it('marks the transient Windows process query as diagnostics collector', () => {
    expect(
      classifyPerformanceProcess({
        pid: 200,
        mainPid: 100,
        name: 'powershell.exe',
        commandLine:
          'powershell.exe -NoProfile -Command Get-CimInstance Win32_Process | Select-Object ProcessId',
      }),
    ).toBe('diagnostics-collector')
  })

  it('marks the transient Unix ps query as diagnostics collector', () => {
    expect(
      classifyPerformanceProcess({
        pid: 201,
        mainPid: 100,
        name: 'ps',
        commandLine: 'ps -ww -axo pid=,ppid=,rss=,ucomm=,args=',
      }),
    ).toBe('diagnostics-collector')
  })

  it('redacts common secrets from command lines', () => {
    expect(
      sanitizeProcessCommandLine(
        'codex --api-key sk-1234567890abcdef --token super-secret OPENAI_API_KEY=another-secret',
      ),
    ).toBe('codex --api-key [redacted] --token [redacted] OPENAI_API_KEY=[redacted]')
  })

  it('summarizes process resources by classified kind', () => {
    const processes = [
      normalizePerformanceProcessRow(
        {
          pid: 100,
          parentPid: null,
          name: 'OpenCove.exe',
          commandLine: 'OpenCove.exe',
          workingSetBytes: 100,
          privateBytes: 70,
          cpuUserTimeMs: 1,
          cpuKernelTimeMs: 2,
          threadCount: 4,
        },
        100,
      ),
      normalizePerformanceProcessRow(
        {
          pid: 101,
          parentPid: 100,
          name: 'codex.exe',
          commandLine: 'codex exec',
          workingSetBytes: 50,
          privateBytes: 40,
          cpuUserTimeMs: 3,
          cpuKernelTimeMs: 4,
          threadCount: 2,
        },
        100,
      ),
    ]

    expect(summarizePerformanceProcesses(processes)).toEqual([
      {
        kind: 'external-agent-codex',
        scope: 'external-agent',
        count: 1,
        workingSetBytes: 50,
        privateBytes: 40,
        threadCount: 2,
      },
      {
        kind: 'opencove-main',
        scope: 'opencove',
        count: 1,
        workingSetBytes: 100,
        privateBytes: 70,
        threadCount: 4,
      },
    ])
  })
})
