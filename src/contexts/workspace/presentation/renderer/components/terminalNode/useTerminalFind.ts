import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { resolveTerminalUiTheme, type TerminalThemeMode } from './theme'
import {
  subscribeTerminalAppliedAppearance,
  type TerminalAppearanceSnapshot,
} from './terminalAppearance'
import type { ResolvedUiTheme } from '@shared/contracts/dto'

export type TerminalFindState = {
  isOpen: boolean
  query: string
  resultIndex: number
  resultCount: number
  caseSensitive: boolean
  useRegex: boolean
}

export function resolveTerminalFindDecorations(terminalScheme: ResolvedUiTheme) {
  return terminalScheme === 'light'
    ? {
        matchBackground: '#d6e8ff',
        matchBorder: '#5e9cff',
        matchOverviewRuler: '#5e9cff',
        activeMatchBackground: '#5e9cff',
        activeMatchBorder: '#5e9cff',
        activeMatchColorOverviewRuler: '#5e9cff',
      }
    : {
        matchBackground: '#18284a',
        matchBorder: '#5e9cff',
        matchOverviewRuler: '#5e9cff',
        activeMatchBackground: '#5e9cff',
        activeMatchBorder: '#5e9cff',
        activeMatchColorOverviewRuler: '#5e9cff',
      }
}

export function rebuildTerminalFindDecorations({
  terminal,
  addon,
  term,
  options,
}: {
  terminal: Terminal
  addon: SearchAddon
  term: string
  options: ISearchOptions
}): boolean {
  const selection = terminal.getSelectionPosition()
  const viewportY = terminal.buffer.active.viewportY

  addon.clearDecorations()
  const matched = addon.findNext(term, { ...options, incremental: true })

  if (selection) {
    const selectionLength = Math.max(
      0,
      (selection.end.y - selection.start.y) * terminal.cols + selection.end.x - selection.start.x,
    )
    terminal.select(selection.start.x, selection.start.y, selectionLength)
  }
  terminal.scrollToLine(viewportY)
  return matched
}

export function useTerminalFind({
  sessionId,
  terminalRef,
  terminalThemeMode,
}: {
  sessionId: string
  terminalRef: React.MutableRefObject<Terminal | null>
  terminalThemeMode: TerminalThemeMode
}): {
  state: TerminalFindState
  open: () => void
  close: () => void
  setQuery: (query: string) => void
  findNext: () => void
  findPrevious: () => void
  toggleCaseSensitive: () => void
  toggleUseRegex: () => void
  bindSearchAddon: (addon: SearchAddon) => () => void
} {
  const addonRef = useRef<SearchAddon | null>(null)
  const appearanceRef = useRef<TerminalAppearanceSnapshot | null>(null)
  const lastDecorationSnapshotRef = useRef<TerminalAppearanceSnapshot | null>(null)
  const [appearanceSnapshot, setAppearanceSnapshot] = useState<TerminalAppearanceSnapshot | null>(
    null,
  )
  const [addonRevision, setAddonRevision] = useState(0)
  const [state, setState] = useState<TerminalFindState>({
    isOpen: false,
    query: '',
    resultIndex: 0,
    resultCount: 0,
    caseSensitive: false,
    useRegex: false,
  })

  useEffect(() => {
    appearanceRef.current = null
    lastDecorationSnapshotRef.current = null
    setAppearanceSnapshot(null)
    setState(prev => ({
      isOpen: false,
      query: '',
      resultIndex: 0,
      resultCount: 0,
      caseSensitive: prev.caseSensitive,
      useRegex: prev.useRegex,
    }))
  }, [sessionId])

  useEffect(
    () =>
      subscribeTerminalAppliedAppearance((terminal, snapshot) => {
        if (terminalRef.current !== terminal) {
          return
        }
        appearanceRef.current = snapshot
        setAppearanceSnapshot(snapshot)
      }),
    [terminalRef],
  )

  useEffect(() => {
    if (!state.isOpen) {
      return
    }

    const addon = addonRef.current
    if (!addon) {
      return
    }

    const term = state.query.trim()
    if (term.length === 0) {
      addon.clearDecorations()
      setState(prev => ({
        ...prev,
        resultIndex: 0,
        resultCount: 0,
      }))
      return
    }

    const decorations = resolveTerminalFindDecorations(
      appearanceRef.current?.terminalScheme ?? resolveTerminalUiTheme(terminalThemeMode),
    )
    const searchOptions: ISearchOptions = {
      incremental: true,
      caseSensitive: state.caseSensitive,
      regex: state.useRegex,
      decorations,
    }
    const isAppearanceRebuild = appearanceSnapshot !== lastDecorationSnapshotRef.current
    lastDecorationSnapshotRef.current = appearanceSnapshot
    const terminal = terminalRef.current
    const ok =
      isAppearanceRebuild && terminal
        ? rebuildTerminalFindDecorations({ terminal, addon, term, options: searchOptions })
        : addon.findNext(term, searchOptions)

    if (!ok) {
      setState(prev => ({
        ...prev,
        resultIndex: 0,
        resultCount: 0,
      }))
    }
  }, [
    addonRevision,
    appearanceSnapshot,
    state.isOpen,
    state.query,
    state.caseSensitive,
    state.useRegex,
    terminalRef,
    terminalThemeMode,
  ])

  const bindSearchAddon = useCallback((addon: SearchAddon) => {
    addonRef.current = addon
    setAddonRevision(revision => revision + 1)

    const resultsDisposable = addon.onDidChangeResults(event => {
      setState(prev =>
        prev.isOpen
          ? {
              ...prev,
              resultIndex: event.resultIndex,
              resultCount: event.resultCount,
            }
          : prev,
      )
    })

    return () => {
      resultsDisposable.dispose()
      addon.clearDecorations()
      addonRef.current = null
    }
  }, [])

  const open = useCallback(() => {
    setState(prev => ({
      ...prev,
      isOpen: true,
    }))
  }, [])

  const close = useCallback(() => {
    const addon = addonRef.current
    addon?.clearDecorations()
    setState(prev => ({
      ...prev,
      isOpen: false,
      resultIndex: 0,
      resultCount: 0,
    }))
    terminalRef.current?.focus()
  }, [terminalRef])

  const setQuery = useCallback((query: string) => {
    setState(prev => ({
      ...prev,
      query,
    }))
  }, [])

  const findNext = useCallback(() => {
    const addon = addonRef.current
    const term = state.query.trim()
    if (!addon || term.length === 0) {
      return
    }

    addon.findNext(term, {
      caseSensitive: state.caseSensitive,
      regex: state.useRegex,
      decorations: resolveTerminalFindDecorations(
        appearanceRef.current?.terminalScheme ?? resolveTerminalUiTheme(terminalThemeMode),
      ),
    })
  }, [state.query, state.caseSensitive, state.useRegex, terminalThemeMode])

  const findPrevious = useCallback(() => {
    const addon = addonRef.current
    const term = state.query.trim()
    if (!addon || term.length === 0) {
      return
    }

    addon.findPrevious(term, {
      caseSensitive: state.caseSensitive,
      regex: state.useRegex,
      decorations: resolveTerminalFindDecorations(
        appearanceRef.current?.terminalScheme ?? resolveTerminalUiTheme(terminalThemeMode),
      ),
    })
  }, [state.query, state.caseSensitive, state.useRegex, terminalThemeMode])

  const toggleCaseSensitive = useCallback(() => {
    setState(prev => ({ ...prev, caseSensitive: !prev.caseSensitive }))
  }, [])

  const toggleUseRegex = useCallback(() => {
    setState(prev => ({ ...prev, useRegex: !prev.useRegex }))
  }, [])

  return {
    state,
    open,
    close,
    setQuery,
    findNext,
    findPrevious,
    toggleCaseSensitive,
    toggleUseRegex,
    bindSearchAddon,
  }
}
