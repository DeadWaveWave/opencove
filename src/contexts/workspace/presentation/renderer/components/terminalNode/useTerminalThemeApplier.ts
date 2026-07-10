import { useCallback, useEffect, useRef } from 'react'
import type { Terminal } from '@xterm/xterm'
import type { MutableRefObject } from 'react'
import type { TerminalThemeMode } from './theme'
import { runTerminalRenderMutationSafely } from './renderServiceSafety'
import {
  createTerminalAppearanceRefreshCoordinator,
  getOrCreateTerminalAppearanceOwner,
  publishTerminalAppearanceSnapshot,
  resolveCurrentTerminalAppearanceValue,
  resolveDesiredTerminalAppearanceValue,
  type TerminalAppearanceRefreshCoordinator,
  type TerminalAppearanceTheme,
} from './terminalAppearance'

export function useTerminalThemeApplier({
  terminalRef,
  containerRef,
  terminalThemeMode = 'sync-with-ui',
  terminalLifecycleKey,
}: {
  terminalRef: MutableRefObject<Terminal | null>
  containerRef: MutableRefObject<HTMLDivElement | null>
  terminalThemeMode?: TerminalThemeMode
  terminalLifecycleKey?: string | number
}): () => void {
  const coordinatorRef = useRef<{
    terminal: Terminal
    coordinator: TerminalAppearanceRefreshCoordinator
  } | null>(null)

  useEffect(() => {
    return () => {
      coordinatorRef.current?.coordinator.dispose()
      coordinatorRef.current = null
    }
  }, [terminalLifecycleKey])

  return useCallback(() => {
    const terminal = terminalRef.current
    if (!terminal) {
      return
    }

    const container = containerRef.current
    const terminalNode = container?.closest('.terminal-node') ?? null

    const currentTheme = (
      terminal.options as unknown as {
        theme?: Partial<TerminalAppearanceTheme>
      }
    ).theme
    const appearanceOwner = getOrCreateTerminalAppearanceOwner(
      terminal,
      resolveCurrentTerminalAppearanceValue({
        terminalThemeMode,
        scope: terminalNode,
        xtermTheme: currentTheme,
      }),
      { initiallyApplied: false },
    )
    const appliedAppearance = appearanceOwner.getAppliedSnapshot()
    if (appliedAppearance) {
      // A surviving Terminal may be attached to replacement DOM. Project only the currently
      // applied snapshot here; a pending desired revision remains invisible until its rAF commit.
      publishTerminalAppearanceSnapshot(container, appliedAppearance)
    }

    if (coordinatorRef.current?.terminal !== terminal) {
      coordinatorRef.current?.coordinator.dispose()
      coordinatorRef.current = {
        terminal,
        coordinator: createTerminalAppearanceRefreshCoordinator({
          owner: appearanceOwner,
          apply: snapshot => {
            terminal.options.theme = { ...snapshot.xtermTheme }
          },
          refresh: snapshot => {
            const didRefresh = runTerminalRenderMutationSafely(() => {
              terminal.refresh(0, Math.max(0, terminal.rows - 1))
            })
            if (!didRefresh) {
              throw new Error('Terminal render surface is detached during theme refresh.')
            }
            publishTerminalAppearanceSnapshot(containerRef.current, snapshot)
          },
        }),
      }
    }

    const nextAppearance = resolveDesiredTerminalAppearanceValue({
      terminalThemeMode,
      sourceScope: terminalNode,
    })
    const coordinator = coordinatorRef.current.coordinator
    coordinator.request(appearanceOwner.update(nextAppearance))
    if (document.visibilityState === 'hidden') {
      coordinator.flushNow()
    }
  }, [containerRef, terminalRef, terminalThemeMode])
}
