import { expect, test, type Page } from '@playwright/test'
import { buildNodeEvalCommand, clearAndSeedWorkspace, launchApp } from './workspace-canvas.helpers'

const NODE_ID = 'terminal-output-stability'
const PROGRESS_FRAME_PREFIX = 'OC_PROGRESS_FRAME_'
const PROGRESS_DONE_MARKER = 'OC_PROGRESS_DONE'
const TUI_FRAME_PREFIX = 'OC_TUI_FRAME_'
const TUI_DONE_MARKER = 'OC_TUI_DONE'

type Geometry = { cols: number; rows: number }

type OutputSample = {
  renderer: Geometry | null
  proposed: Geometry | null
  worker: Geometry & { revision: number | null }
  baseY: number | null
  progressFrameCount: number
  tuiFrameCount: number
  tuiSecondRow: string
  transcript: string
}

type TranscriptDebugWindow = Window & {
  __OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__?: (nodeId: string) => string
}

function geometryKey(geometry: Geometry): string {
  return `${geometry.cols}x${geometry.rows}`
}

function uniqueValues<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function countOccurrences(text: string, token: string): number {
  return text.split(token).length - 1
}

function readMarkerValue(transcript: string, marker: string): string | null {
  const prefix = `${marker}=`
  const line = transcript
    .split('\n')
    .map(value => value.trim())
    .find(value => value.startsWith(prefix))
  return line?.slice(prefix.length).trim() ?? null
}

function createGeometryRecorderSource(prefix: string): string[] {
  return [
    'const ttyGeometries = new Set();',
    'const ttyResizeEvents = [];',
    'const readTtyGeometry = () => `${process.stdout.columns || 0}x${process.stdout.rows || 0}`;',
    `const initialTtyGeometry = readTtyGeometry();`,
    `process.stdout.on('resize', () => ttyResizeEvents.push(readTtyGeometry()));`,
    `const writeTtyReport = () => {`,
    `  process.stdout.write(${JSON.stringify(`\r\x1b[2K${prefix}_TTY_INITIAL=`)} + initialTtyGeometry + ${JSON.stringify('\n')});`,
    `  process.stdout.write(${JSON.stringify(`${prefix}_TTY_UNIQUE=`)} + [...ttyGeometries].join(',') + ${JSON.stringify('\n')});`,
    `  process.stdout.write(${JSON.stringify(`${prefix}_TTY_RESIZE_COUNT=`)} + ttyResizeEvents.length + ${JSON.stringify('\n')});`,
    `  process.stdout.write(${JSON.stringify(`${prefix}_TTY_RESIZE_GEOMETRIES=`)} + [...new Set(ttyResizeEvents)].join(',') + ${JSON.stringify('\n')});`,
    `};`,
  ]
}

function createProgressProgram(frameCount: number): string {
  return [
    ...createGeometryRecorderSource('OC_PROGRESS'),
    'let frame = 0;',
    'const timer = setInterval(() => {',
    '  const cols = process.stdout.columns || 80;',
    '  ttyGeometries.add(readTtyGeometry());',
    `  const prefix = ${JSON.stringify(PROGRESS_FRAME_PREFIX)} + String(frame).padStart(3, '0') + '_';`,
    "  const line = (prefix + '='.repeat(Math.max(0, cols - prefix.length))).slice(0, cols);",
    `  process.stdout.write(${JSON.stringify('\r\x1b[2K')} + line);`,
    '  frame += 1;',
    `  if (frame < ${frameCount}) return;`,
    '  clearInterval(timer);',
    '  setTimeout(() => {',
    '    writeTtyReport();',
    `    process.stdout.write(${JSON.stringify(`${PROGRESS_DONE_MARKER}\n`)});`,
    '  }, 60);',
    '}, 20);',
  ].join('')
}

function createAlternateScreenProgram(frameCount: number): string {
  return [
    ...createGeometryRecorderSource('OC_TUI'),
    `process.stdout.write(${JSON.stringify('\x1b[?1049h\x1b[2J\x1b[H')});`,
    'let frame = 0;',
    'const timer = setInterval(() => {',
    '  const cols = process.stdout.columns || 80;',
    '  ttyGeometries.add(readTtyGeometry());',
    `  const prefix = ${JSON.stringify(TUI_FRAME_PREFIX)} + String(frame).padStart(3, '0') + '_';`,
    "  const line = (prefix + '#'.repeat(Math.max(0, cols - prefix.length))).slice(0, cols);",
    `  process.stdout.write(${JSON.stringify('\x1b[H\x1b[2K')} + line);`,
    '  frame += 1;',
    `  if (frame < ${frameCount}) return;`,
    '  clearInterval(timer);',
    '  setTimeout(() => {',
    `    process.stdout.write(${JSON.stringify('\x1b[?1049l')});`,
    '    writeTtyReport();',
    `    process.stdout.write(${JSON.stringify(`${TUI_DONE_MARKER}\n`)});`,
    '  }, 60);',
    '}, 20);',
  ].join('')
}

async function forceDomRendererOnNextNavigation(window: Page): Promise<void> {
  await window.addInitScript(() => {
    const originalGetContext = HTMLCanvasElement.prototype.getContext
    Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
      configurable: true,
      value(this: HTMLCanvasElement, contextId: string, ...args: unknown[]) {
        if (contextId === 'webgl' || contextId === 'webgl2' || contextId === 'experimental-webgl') {
          return null
        }
        return Reflect.apply(originalGetContext, this, [contextId, ...args])
      },
    })
  })
}

async function readRuntimeSessionId(window: Page): Promise<string | null> {
  return await window.evaluate(nodeId => {
    return window.__opencoveTerminalSelectionTestApi?.getRuntimeSessionId(nodeId) ?? null
  }, NODE_ID)
}

async function readOutputSample(window: Page, sessionId: string): Promise<OutputSample> {
  return await window.evaluate(
    async payload => {
      const api = window.__opencoveTerminalSelectionTestApi
      const metrics = api?.getRenderMetrics(payload.nodeId) ?? null
      const worker = await window.opencoveApi.pty.presentationSnapshot({
        sessionId: payload.runtimeSessionId,
      })
      const transcript =
        (window as TranscriptDebugWindow).__OPENCOVE_TEST_READ_TERMINAL_TRANSCRIPT__?.(
          payload.nodeId,
        ) ?? ''
      const lines = transcript.split('\n')
      const hasTuiFrame = transcript.includes(payload.tuiPrefix)

      return {
        renderer: api?.getSize(payload.nodeId) ?? null,
        proposed: api?.getProposedGeometry(payload.nodeId) ?? null,
        worker: {
          cols: worker.cols,
          rows: worker.rows,
          revision: worker.geometryRevision,
        },
        baseY: metrics?.baseY ?? null,
        progressFrameCount: transcript.split(payload.progressPrefix).length - 1,
        tuiFrameCount: transcript.split(payload.tuiPrefix).length - 1,
        tuiSecondRow: hasTuiFrame ? (lines[1]?.trim() ?? '') : '',
        transcript,
      }
    },
    {
      nodeId: NODE_ID,
      runtimeSessionId: sessionId,
      progressPrefix: PROGRESS_FRAME_PREFIX,
      tuiPrefix: TUI_FRAME_PREFIX,
    },
  )
}

async function runProgramAndSample(options: {
  window: Page
  sessionId: string
  program: string
  doneMarker: string
}): Promise<OutputSample[]> {
  const shellCommand = buildNodeEvalCommand(options.program)
  await options.window.evaluate(
    async payload => {
      await window.opencoveApi.pty.write({
        sessionId: payload.runtimeSessionId,
        data: `${payload.shellCommand}\r`,
      })
    },
    { runtimeSessionId: options.sessionId, shellCommand },
  )

  const samples: OutputSample[] = []
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop -- high-frequency real renderer/Worker sampling
    const sample = await readOutputSample(options.window, options.sessionId)
    samples.push(sample)
    if (sample.transcript.includes(options.doneMarker)) {
      return samples
    }
    // eslint-disable-next-line no-await-in-loop -- bounded sampling interval
    await options.window.waitForTimeout(8)
  }

  throw new Error(`Timed out waiting for terminal marker: ${options.doneMarker}`)
}

function assertGeometryInvariant(options: {
  label: string
  samples: OutputSample[]
  expected: Geometry
  expectedRevision: number | null
}): void {
  const rendererGeometries = options.samples
    .map(sample => sample.renderer)
    .filter((geometry): geometry is Geometry => geometry !== null)
    .map(geometryKey)
  const proposedGeometries = options.samples
    .map(sample => sample.proposed)
    .filter((geometry): geometry is Geometry => geometry !== null)
    .map(geometryKey)
  const workerGeometries = options.samples.map(sample => geometryKey(sample.worker))
  const workerRevisions = options.samples.map(sample => sample.worker.revision)
  const expectedKey = geometryKey(options.expected)

  expect(uniqueValues(rendererGeometries), `${options.label}: renderer geometry drift`).toEqual([
    expectedKey,
  ])
  expect(uniqueValues(proposedGeometries), `${options.label}: fit proposal drift`).toEqual([
    expectedKey,
  ])
  expect(uniqueValues(workerGeometries), `${options.label}: Worker geometry drift`).toEqual([
    expectedKey,
  ])
  expect(
    uniqueValues(workerRevisions),
    `${options.label}: output caused geometry revision`,
  ).toEqual([options.expectedRevision])
}

function assertChildTtyReport(options: {
  transcript: string
  prefix: 'OC_PROGRESS' | 'OC_TUI'
  expected: Geometry
}): void {
  const expectedKey = geometryKey(options.expected)
  expect(readMarkerValue(options.transcript, `${options.prefix}_TTY_INITIAL`)).toBe(expectedKey)
  expect(readMarkerValue(options.transcript, `${options.prefix}_TTY_UNIQUE`)).toBe(expectedKey)
  expect(readMarkerValue(options.transcript, `${options.prefix}_TTY_RESIZE_COUNT`)).toBe('0')
  expect(readMarkerValue(options.transcript, `${options.prefix}_TTY_RESIZE_GEOMETRIES`)).toBe('')
}

test.describe('Workspace Canvas - Terminal continuous output stability', () => {
  test('keeps DOM renderer, Worker and child TTY geometry identical during progress and TUI redraws', async () => {
    const { electronApp, window } = await launchApp({
      env: { OPENCOVE_TERMINAL_DIAGNOSTICS: '1' },
    })

    try {
      await forceDomRendererOnNextNavigation(window)
      await clearAndSeedWorkspace(window, [
        {
          id: NODE_ID,
          title: NODE_ID,
          position: { x: 120, y: 120 },
          width: 680,
          height: 380,
        },
      ])

      const terminal = window.locator('.terminal-node').first()
      await expect(terminal.locator('.xterm')).toBeVisible()
      await expect(terminal.locator('.terminal-node__terminal')).toHaveAttribute(
        'data-cove-terminal-renderer',
        'dom',
      )
      await expect.poll(() => readRuntimeSessionId(window), { timeout: 15_000 }).toBeTruthy()
      const sessionId = await readRuntimeSessionId(window)
      expect(sessionId).not.toBeNull()

      await window.waitForTimeout(800)
      const baseline = await readOutputSample(window, sessionId!)
      expect(baseline.worker.revision).not.toBeNull()
      const expectedGeometry: Geometry = {
        cols: baseline.worker.cols,
        rows: baseline.worker.rows,
      }

      const progressSamples = await runProgramAndSample({
        window,
        sessionId: sessionId!,
        program: createProgressProgram(80),
        doneMarker: PROGRESS_DONE_MARKER,
      })
      const progressVisibleSamples = progressSamples.filter(sample => sample.progressFrameCount > 0)
      expect(progressVisibleSamples.length).toBeGreaterThan(3)
      assertGeometryInvariant({
        label: 'progress',
        samples: [baseline, ...progressSamples],
        expected: expectedGeometry,
        expectedRevision: baseline.worker.revision,
      })
      expect(
        Math.max(...progressVisibleSamples.map(sample => sample.progressFrameCount)),
        'carriage-return progress accumulated instead of replacing one row',
      ).toBeLessThanOrEqual(1)
      expect(
        uniqueValues(progressVisibleSamples.map(sample => sample.baseY)),
        'carriage-return progress grew terminal scrollback',
      ).toHaveLength(1)
      const progressFinal = progressSamples.at(-1)!
      expect(countOccurrences(progressFinal.transcript, PROGRESS_FRAME_PREFIX)).toBe(0)
      assertChildTtyReport({
        transcript: progressFinal.transcript,
        prefix: 'OC_PROGRESS',
        expected: expectedGeometry,
      })

      const tuiSamples = await runProgramAndSample({
        window,
        sessionId: sessionId!,
        program: createAlternateScreenProgram(80),
        doneMarker: TUI_DONE_MARKER,
      })
      const tuiVisibleSamples = tuiSamples.filter(sample => sample.tuiFrameCount > 0)
      expect(tuiVisibleSamples.length).toBeGreaterThan(3)
      assertGeometryInvariant({
        label: 'alternate-screen TUI',
        samples: tuiSamples,
        expected: expectedGeometry,
        expectedRevision: baseline.worker.revision,
      })
      expect(
        uniqueValues(tuiVisibleSamples.map(sample => sample.tuiSecondRow)),
        'full-width TUI frame wrapped into the second row',
      ).toEqual([''])
      const tuiFinal = tuiSamples.at(-1)!
      assertChildTtyReport({
        transcript: tuiFinal.transcript,
        prefix: 'OC_TUI',
        expected: expectedGeometry,
      })
    } finally {
      await electronApp.close()
    }
  })
})
