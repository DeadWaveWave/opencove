import { useCallback, useEffect, useRef, useState } from 'react'
import { SearchAddon } from '@xterm/addon-search'
import type { Terminal } from '@xterm/xterm'
import { resolveTerminalUiTheme, type TerminalThemeMode } from './theme'

export type TerminalFindState = {
  isOpen: boolean
  query: string
  resultIndex: number
  resultCount: number
}

function resolveDecorations(terminalThemeMode: TerminalThemeMode) {
  const resolvedUiTheme = resolveTerminalUiTheme(terminalThemeMode)
  return resolvedUiTheme === 'light'
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
  bindSearchAddon: (addon: SearchAddon) => () => void
} {
  const addonRef = useRef<SearchAddon | null>(null)
  const [state, setState] = useState<TerminalFindState>({
    isOpen: false,
    query: '',
    resultIndex: 0,
    resultCount: 0,
  })

  useEffect(() => {
    setState({
      isOpen: false,
      query: '',
      resultIndex: 0,
      resultCount: 0,
    })
  }, [sessionId])

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

    const ok = addon.findNext(term, {
      incremental: true,
      decorations: resolveDecorations(terminalThemeMode),
    })

    if (!ok) {
      setState(prev => ({
        ...prev,
        resultIndex: 0,
        resultCount: 0,
      }))
    }
  }, [state.isOpen, state.query, terminalThemeMode])

  const bindSearchAddon = useCallback((addon: SearchAddon) => {
    addonRef.current = addon

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
      decorations: resolveDecorations(terminalThemeMode),
    })
  }, [state.query, terminalThemeMode])

  const findPrevious = useCallback(() => {
    const addon = addonRef.current
    const term = state.query.trim()
    if (!addon || term.length === 0) {
      return
    }

    addon.findPrevious(term, {
      decorations: resolveDecorations(terminalThemeMode),
    })
  }, [state.query, terminalThemeMode])

  return {
    state,
    open,
    close,
    setQuery,
    findNext,
    findPrevious,
    bindSearchAddon,
  }
}
