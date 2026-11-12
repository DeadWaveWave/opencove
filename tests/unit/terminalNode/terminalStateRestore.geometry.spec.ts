import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Terminal } from '@xterm/xterm'
import { TerminalPresentationSession } from '../../../src/platform/terminal/presentation/TerminalPresentationSession'
import { hydrateTerminalFromSnapshot } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrateFromSnapshot'
import { prepareRuntimePresentationAttach } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.support'
import { createRuntimeInitialGeometryCommitter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useTerminalRuntimeSession.initialGeometry'
import { commitTerminalGeometryForCurrentSession } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/useCommittedTerminalGeometry'
import { createTerminalHydrationRouter } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/hydrationRouter'
import { readTerminalEmulationStateForTest } from '../../../src/contexts/workspace/presentation/renderer/components/terminalNode/terminalRenderTestProbe'
import { createRollingTextBuffer } from '../../../src/contexts/workspace/presentation/renderer/utils/rollingTextBuffer'
import {
  cleanupTerminalGeometrySyncTestWindow,
  installTerminalGeometrySyncTestWindow,
  ptyResize,
} from './terminalGeometrySync.testHarness'

const originalGrid = { cols: 69, rows: 48 }
const appearanceGrid = { cols: 52, rows: 36 }
const write = (terminal: Terminal, data: string) =>
  new Promise<void>(resolve => terminal.write(data, resolve))
const viewport = (terminal: Terminal) =>
  Array.from({ length: terminal.rows }, (_, row) =>
    terminal.buffer.active.getLine(terminal.buffer.active.viewportY + row)?.translateToString(true),
  )

describe('alternate hydration across an appearance geometry commit', () => {
  beforeEach(installTerminalGeometrySyncTestWindow)
  afterEach(cleanupTerminalGeometrySyncTestWindow)

  it.each(['initial snapshot delivery', 'post-commit snapshot request'])(
    'keeps Worker state when appearance supersedes %s geometry',
    async timing => {
      const sessionId = 'appearance-state'
      const worker = new TerminalPresentationSession({ sessionId, ...originalGrid })
      const options = { ...originalGrid, allowProposedApi: true, convertEol: true }
      const renderer = new Terminal(options),
        source = new Terminal(options)
      // Parser/buffers/resize are real; only the unopened DOM paint leaf is omitted.
      vi.spyOn(renderer, 'refresh').mockImplementation(() => undefined)
      const initial =
        'NORMAL_BEHIND' +
        '\x1b[?1049h\x1b[?2004h\x1b[?1003h\x1b[?1006h\x1b[?1h\x1b[?66h\x1b[?1004h\x1b[?25l' +
        Array.from({ length: 30 }, (_, i) => `HISTORY_${i + 1}`).join('\r\n')
      const status = '\x1b[34;1H\r\x1b[2KWORKING_AFTER_FONT_CHANGE'
      const buffer = () => createRollingTextBuffer({ maxChars: 100_000 })
      const router = createTerminalHydrationRouter({
        terminal: renderer,
        outputScheduler: { handleChunk: data => renderer.write(data) },
        shouldReplaceAgentPlaceholderAfterHydration: () => false,
        shouldReplaceAuthoritativeBaselineWithBufferedOutput: () => true,
        shouldDeferHydratedRedrawChunks: () => true,
        scrollbackBuffer: buffer(),
        committedScrollbackBuffer: buffer(),
        recordCommittedScreenState: vi.fn(),
        scheduleTranscriptSync: vi.fn(),
        ptyWriteQueue: { flush: vi.fn() },
        markScrollbackDirty: vi.fn(),
        logHydrated: vi.fn(),
        syncTerminalSize: vi.fn(),
        onRevealed: vi.fn(),
        isDisposed: () => false,
      })
      try {
        worker.resize(originalGrid.cols, originalGrid.rows, 1)
        await Promise.all([worker.applyOutput(1, initial), write(source, initial)])
        const lastCommittedPtySizeRef = { current: { ...originalGrid } }
        let measured = { ...originalGrid }
        const geometryOptions = {
          terminalRef: { current: renderer },
          fitAddonRef: { current: { proposeDimensions: () => measured } as never },
          containerRef: { current: { clientWidth: 600, clientHeight: 700 } as HTMLElement },
          isPointerResizingRef: { current: false },
          lastCommittedPtySizeRef,
          sessionId,
        }
        ptyResize.mockImplementation(async payload => {
          const changed = payload.cols !== originalGrid.cols || payload.rows !== originalGrid.rows
          const revision = changed ? 2 : 1
          worker.resize(payload.cols, payload.rows, revision)
          source.resize(payload.cols, payload.rows)
          await worker.flush()
          return {
            sessionId,
            operationId: payload.operationId,
            status: 'accepted',
            changed,
            geometry: { cols: payload.cols, rows: payload.rows, revision },
            authority: { role: 'controller', epoch: 1 },
          }
        })
        const changeAppearance = async () => {
          measured = { ...appearanceGrid }
          await commitTerminalGeometryForCurrentSession(
            {
              ...geometryOptions,
              suppressPtyResizeRef: { current: false },
              latestSessionIdRef: { current: sessionId },
              scheduleWebglCanvasTransformCleanup: vi.fn(),
            },
            'appearance_commit',
          )
          await Promise.all([worker.applyOutput(2, status), write(source, status)])
          router.handleDataChunk(status, { seq: 2 })
        }
        let requests = 0
        const presentationSnapshot = vi.fn(async () => {
          requests += 1
          if (timing === 'post-commit snapshot request' && requests === 2) {
            await changeAppearance()
          }
          const captured = await worker.snapshot()
          if (timing === 'initial snapshot delivery' && requests === 1) {
            // A font change commits while the OLD baseline delivery is held.
            await changeAppearance()
          }
          return captured
        })
        Object.assign(window.opencoveApi.pty, { presentationSnapshot })
        const attach = vi.fn(async () => ({
          sessionId,
          authority: { role: 'controller' as const, epoch: 1 },
        }))
        const { attachPromise, presentationSnapshotPromise } = prepareRuntimePresentationAttach({
          sessionId,
          ptyApi: { attach } as never,
          isLiveSessionReattach: timing === 'post-commit snapshot request',
          commitInitialGeometry: createRuntimeInitialGeometryCommitter({
            ...geometryOptions,
            canonicalInitialGeometry: originalGrid,
            preferMeasuredGeometryCommit: timing === 'post-commit snapshot request',
          }),
        })
        const takePtySnapshot = vi.fn(async () => ({ data: status }))
        const accept = vi.fn()
        await hydrateTerminalFromSnapshot({
          terminal: renderer,
          sessionId,
          kind: 'agent',
          useLivePtySnapshotDuringHydration: false,
          attachPromise,
          presentationSnapshotPromise,
          persistedSnapshot: '',
          cachedScreenState: null,
          takePtySnapshot,
          isDisposed: () => false,
          onPresentationSnapshotAccepted: accept,
          onHydratedWriteCommitted: vi.fn(),
          finalizeHydration: (data, extra) => router.finalizeHydration(data, extra),
        })
        await write(renderer, '')
        expect
          .soft(readTerminalEmulationStateForTest(renderer))
          .toEqual(readTerminalEmulationStateForTest(source))
        expect.soft({ cols: renderer.cols, rows: renderer.rows }).toEqual(appearanceGrid)
        expect.soft(viewport(renderer)).toEqual(viewport(source))
        expect.soft(viewport(renderer).join('\n')).toContain('HISTORY_12')
        expect.soft(viewport(renderer).join('\n')).toContain('HISTORY_23')
        expect.soft(accept).toHaveBeenCalledWith(
          expect.objectContaining({
            geometryRevision: 2,
            appliedSeq: 2,
            bufferKind: 'alternate',
          }),
        )
        expect(presentationSnapshot).toHaveBeenCalledTimes(2)
        expect(takePtySnapshot).not.toHaveBeenCalled()
      } finally {
        worker.dispose()
        renderer.dispose()
        source.dispose()
      }
    },
  )
})
