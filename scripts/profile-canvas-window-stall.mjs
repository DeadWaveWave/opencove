#!/usr/bin/env node
import { _electron as electron } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { cpus, release, tmpdir } from 'node:os'
import path from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import {
  createNodes,
  seedProfileUserData,
  seedWorkspace,
  spawnTerminalSessions,
  waitForWorkspace,
} from './lib/terminal-load-profile-workspace.mjs'
import { installProbes, runPan } from './lib/canvas-window-profile-probes.mjs'
import { readProfileConfig, summarizeCapture } from './lib/canvas-window-profile-metrics.mjs'

const repoPath = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const config = readProfileConfig()
const categories = [
  'toplevel',
  'electron',
  'devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'latencyInfo',
  'input',
  'cc',
  'viz',
  'gpu',
  'disabled-by-default-devtools.timeline',
  'disabled-by-default-devtools.timeline.frame',
  'disabled-by-default-v8.cpu_profiler',
]

async function main() {
  const artifactDir = path.join(
    repoPath,
    'artifacts',
    'canvas-window-stall-profile',
    new Date().toISOString().replace(/[:.]/g, '-'),
  )
  await mkdir(artifactDir, { recursive: true })
  const userDataDir = await mkdtemp(path.join(tmpdir(), 'opencove-canvas-profile-'))
  const report = {
    config,
    categories,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf8',
    }).trim(),
    host: {
      platform: process.platform,
      arch: process.arch,
      release: release(),
      cpu: cpus()[0]?.model,
      cpuCount: cpus().length,
    },
    error: null,
  }
  let electronApp
  let page
  let cdp
  let traceStarted = false
  let cpuStarted = false
  let probesStarted = false
  const logs = []
  const save = (name, value) =>
    writeFile(path.join(artifactDir, name), `${JSON.stringify(value, null, 2)}\n`)
  try {
    await seedProfileUserData({ userDataDir, repoPath })
    const env = { ...process.env }
    delete env.ELECTRON_RUN_AS_NODE
    delete env.__CFBundleIdentifier
    const directories = new Set()
    const isolatedDirectories = {
      HOME: 'home',
      USERPROFILE: 'home',
      APPDATA: 'app-data',
      LOCALAPPDATA: 'local-app-data',
      XDG_CONFIG_HOME: 'config',
      XDG_CACHE_HOME: 'cache',
      XDG_RUNTIME_DIR: 'runtime',
    }
    for (const [key, folder] of Object.entries(isolatedDirectories)) {
      env[key] = path.join(userDataDir, folder)
      directories.add(env[key])
    }
    await Promise.all([...directories].map(directory => mkdir(directory, { recursive: true })))
    env.PSModuleAnalysisCachePath = path.join(env.LOCALAPPDATA, 'ModuleAnalysisCache')
    report.environmentIsolation = {
      redirectedDirectories: isolatedDirectories,
      powerShellModuleCache: 'local-app-data/ModuleAnalysisCache',
      inheritedHostVariableNames: [
        'PATH',
        'SystemRoot',
        'COMSPEC',
        'HOMEDRIVE',
        'HOMEPATH',
        'PSModulePath',
      ].filter(name => env[name] !== undefined),
      limitations: [
        'Disposable userData and empty home/config/cache directories differ from an installed user profile.',
        'Inherited executable discovery, system shell modules, OS account, registry and machine caches are not isolated.',
        'Windows USERPROFILE/APPDATA/LOCALAPPDATA and PowerShell analysis cache redirection can alter startup and shell configuration costs.',
        'NODE_ENV=test uses fixture behavior and synthetic terminal output; this is not packaged-release or real-agent parity.',
      ],
    }
    electronApp = await electron.launch({
      args: [repoPath],
      timeout: 60_000,
      env: {
        ...env,
        NODE_ENV: 'test',
        OPENCOVE_TEST_USER_DATA_DIR: userDataDir,
        OPENCOVE_TEST_WORKSPACE: repoPath,
        OPENCOVE_TEST_NODE_EXECUTABLE: process.execPath,
        OPENCOVE_E2E_WINDOW_MODE: 'inactive',
        OPENCOVE_E2E_FORCE_RENDERER_SANDBOX: '1',
        OPENCOVE_TERMINAL_DIAGNOSTICS: '0',
        OPENCOVE_TERMINAL_INPUT_DIAGNOSTICS: '0',
      },
    })
    for (const stream of [electronApp.process().stdout, electronApp.process().stderr]) {
      stream?.on('data', chunk => {
        if (logs.length < 2_000) {
          logs.push(chunk.toString().slice(0, 8_192))
        }
      })
    }
    page = await electronApp.firstWindow()
    page.setDefaultTimeout(30_000)
    await seedWorkspace(page, { repoPath, nodes: [] })
    await waitForWorkspace(page)
    if (config.terminalCount > 0) {
      const sessions = await spawnTerminalSessions(page, {
        repoPath,
        ...config,
        sampleDurationMs: config.sampleDurationMs + 60_000,
      })
      await seedWorkspace(page, { repoPath, nodes: createNodes(sessions, { repoPath }) })
      await waitForWorkspace(page)
      await page.waitForFunction(
        count => document.querySelectorAll('.terminal-node .xterm').length === count,
        config.terminalCount,
      )
    }
    report.runtime = await electronApp.evaluate(async ({ app, BrowserWindow, screen }) => {
      const window = BrowserWindow.getAllWindows()[0]
      const display = screen.getDisplayMatching(window.getBounds())
      window.setFullScreen(false)
      window.setBounds(display.workArea)
      window.webContents.setBackgroundThrottling(true)
      window.show()
      window.focus()
      return {
        mainPid: process.pid,
        rendererPid: window.webContents.getOSProcessId(),
        versions: process.versions,
        display: {
          size: display.size,
          workArea: display.workArea,
          scaleFactor: display.scaleFactor,
        },
        bounds: window.getBounds(),
        fullScreen: window.isFullScreen(),
        backgroundThrottling: window.webContents.getBackgroundThrottling(),
        gpu: await app.getGPUInfo('basic'),
        gpuFeatures: app.getGPUFeatureStatus(),
        testMode: true,
      }
    })
    await delay(3_000)
    report.processSnapshot = await page.evaluate(() =>
      window.opencoveApi.performanceDiagnostics.getSnapshot(),
    )
    await page.screenshot({ path: path.join(artifactDir, 'before.png') })
    cdp = await page.context().newCDPSession(page)
    if (config.trace) {
      await electronApp.evaluate(async ({ contentTracing }, included_categories) => {
        await contentTracing.startRecording({
          included_categories,
          excluded_categories: ['*'],
          recording_mode: 'record-until-full',
          trace_buffer_size_in_kb: 102_400,
        })
      }, categories)
      traceStarted = true
      await cdp.send('Profiler.enable')
      await cdp.send('Profiler.start')
      cpuStarted = true
    }
    probesStarted = true
    await installProbes(electronApp, page)
    process.stdout.write(
      `[canvas-profile] ${config.scenario} ${config.sampleDurationMs}ms; main PID ${report.runtime.mainPid}; ${artifactDir}\n`,
    )
    await page.evaluate(name => window.__opencoveStallRenderer.mark(name), config.scenario)
    if (config.scenario === 'pan') {
      report.pan = await runPan(page, config.sampleDurationMs)
    } else {
      await delay(config.sampleDurationMs)
    }
    report.renderer = await page.evaluate(() => window.__opencoveStallRenderer.stop())
    report.main = await electronApp.evaluate(() => globalThis.__opencoveStallMain.stop())
    probesStarted = false
    report.summary = summarizeCapture(report.renderer, report.main)
    if (report.renderer.frames.length === 0 || report.main.samples.length === 0) {
      throw new Error('Capture is missing renderer or main-process samples')
    }
  } catch (error) {
    report.error = { message: error.message, stack: error.stack }
    process.exitCode = 1
  } finally {
    if (probesStarted) {
      report.renderer ??= await page
        ?.evaluate(() => window.__opencoveStallRenderer?.stop())
        .catch(() => null)
      report.main ??= await electronApp
        ?.evaluate(() => globalThis.__opencoveStallMain?.stop())
        .catch(() => null)
    }
    const cleanupErrors = []
    const collect = async action => {
      try {
        await action()
      } catch (error) {
        cleanupErrors.push(error.message)
        process.exitCode = 1
      }
    }
    if (cpuStarted) {
      await collect(async () =>
        save('renderer.cpuprofile', (await cdp.send('Profiler.stop')).profile),
      )
    }
    if (traceStarted) {
      await collect(async () => {
        report.traceBuffer = await electronApp.evaluate(({ contentTracing }) =>
          contentTracing.getTraceBufferUsage(),
        )
        await electronApp.evaluate(
          ({ contentTracing }, outputPath) => contentTracing.stopRecording(outputPath),
          path.join(artifactDir, 'electron-trace.json'),
        )
      })
    }
    if (page) {
      await collect(() => page.screenshot({ path: path.join(artifactDir, 'after.png') }))
    }
    if (cdp) {
      await collect(() => cdp.detach())
    }
    if (electronApp) {
      await collect(() => electronApp.close())
    }
    await collect(() => rm(userDataDir, { recursive: true, force: true }))
    report.cleanupErrors = cleanupErrors
    await save('report.json', report)
    await writeFile(path.join(artifactDir, 'electron.log'), logs.join(''))
    process.stdout.write(
      `${JSON.stringify({ summary: report.summary, error: report.error, cleanupErrors })}\nArtifacts: ${artifactDir}\n`,
    )
  }
}

await main()
