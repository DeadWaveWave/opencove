import type { Terminal } from '@xterm/xterm'
import type { ResolvedUiTheme } from '@shared/contracts/dto'
import { resolveUiThemeTerminalScheme, type UiTheme } from '@contexts/settings/domain/uiSettings'
import {
  resolveActiveUiTheme,
  resolveActiveUiThemeId,
  resolveTerminalThemeFromComputedStyle,
  resolveTerminalUiTheme,
  type TerminalThemeMode,
} from './theme'

export const TERMINAL_APPEARANCE_CSS_VARIABLES = [
  '--cove-accent',
  '--cove-border',
  '--cove-border-subtle',
  '--cove-field',
  '--cove-node-border',
  '--cove-node-header-border',
  '--cove-node-selection-border',
  '--cove-node-selection-shadow',
  '--cove-node-shadow-color',
  '--cove-surface-hover',
  '--cove-terminal-background',
  '--cove-terminal-foreground',
  '--cove-terminal-selection',
  '--cove-terminal-cursor',
  '--cove-terminal-node-surface',
  '--cove-terminal-node-header-surface',
  '--cove-text',
  '--cove-text-faint',
  '--cove-text-muted',
] as const

export type TerminalAppearanceCssVariable = (typeof TERMINAL_APPEARANCE_CSS_VARIABLES)[number]
export type TerminalAppearanceCssTokens = Readonly<
  Partial<Record<TerminalAppearanceCssVariable, string>>
>

export interface TerminalAppearanceTheme {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

export interface TerminalAppearanceValue {
  themeId: UiTheme
  uiScheme: ResolvedUiTheme
  terminalScheme: ResolvedUiTheme
  xtermTheme: Readonly<TerminalAppearanceTheme>
  cssTokens: TerminalAppearanceCssTokens
}

export interface TerminalAppearanceSnapshot extends TerminalAppearanceValue {
  revision: number
}

export interface TerminalAppearanceOwner {
  getDesiredSnapshot: () => TerminalAppearanceSnapshot
  getAppliedSnapshot: () => TerminalAppearanceSnapshot | null
  update: (value: TerminalAppearanceValue) => TerminalAppearanceSnapshot
  markApplied: (snapshot: TerminalAppearanceSnapshot) => boolean
  subscribeApplied: (listener: (snapshot: TerminalAppearanceSnapshot) => void) => () => void
}

function freezeSnapshot(
  revision: number,
  value: TerminalAppearanceValue,
): TerminalAppearanceSnapshot {
  return Object.freeze({
    revision,
    themeId: value.themeId,
    uiScheme: value.uiScheme,
    terminalScheme: value.terminalScheme,
    xtermTheme: Object.freeze({ ...value.xtermTheme }),
    cssTokens: Object.freeze({ ...value.cssTokens }),
  })
}

function appearanceValuesEqual(
  snapshot: TerminalAppearanceSnapshot,
  value: TerminalAppearanceValue,
): boolean {
  return (
    snapshot.themeId === value.themeId &&
    snapshot.uiScheme === value.uiScheme &&
    snapshot.terminalScheme === value.terminalScheme &&
    snapshot.xtermTheme.background === value.xtermTheme.background &&
    snapshot.xtermTheme.foreground === value.xtermTheme.foreground &&
    snapshot.xtermTheme.cursor === value.xtermTheme.cursor &&
    snapshot.xtermTheme.selectionBackground === value.xtermTheme.selectionBackground &&
    TERMINAL_APPEARANCE_CSS_VARIABLES.every(
      variable => snapshot.cssTokens[variable] === value.cssTokens[variable],
    )
  )
}

export function resolveTerminalAppearanceValue({
  themeId,
  uiScheme,
  terminalThemeMode,
  xtermTheme,
  cssTokens = {},
}: {
  themeId: UiTheme
  uiScheme: ResolvedUiTheme
  terminalThemeMode: TerminalThemeMode
  xtermTheme: TerminalAppearanceTheme
  cssTokens?: TerminalAppearanceCssTokens
}): TerminalAppearanceValue {
  const terminalScheme =
    terminalThemeMode === 'dark' ? 'dark' : resolveUiThemeTerminalScheme(themeId, uiScheme)

  return {
    themeId,
    uiScheme,
    terminalScheme,
    xtermTheme: { ...xtermTheme },
    cssTokens: { ...cssTokens },
  }
}

export function resolveCurrentTerminalAppearanceValue({
  terminalThemeMode,
  scope = null,
  xtermTheme,
}: {
  terminalThemeMode: TerminalThemeMode
  scope?: Element | null
  xtermTheme?: Partial<TerminalAppearanceTheme> | null
}): TerminalAppearanceValue {
  const readScope = scope ?? document.documentElement
  const computedStyle = window.getComputedStyle(readScope)
  const cssTokens: Partial<Record<TerminalAppearanceCssVariable, string>> = {}
  TERMINAL_APPEARANCE_CSS_VARIABLES.forEach(variable => {
    const value =
      computedStyle.getPropertyValue(variable).trim() ||
      document.documentElement.style.getPropertyValue(variable).trim()
    if (value.length > 0) {
      cssTokens[variable] = value
    }
  })
  const fallbackTheme = resolveTerminalThemeFromComputedStyle(terminalThemeMode, computedStyle)

  return resolveTerminalAppearanceValue({
    themeId: resolveActiveUiThemeId(),
    uiScheme: resolveActiveUiTheme(),
    terminalThemeMode,
    xtermTheme: {
      background:
        xtermTheme?.background ??
        cssTokens['--cove-terminal-background'] ??
        fallbackTheme.background,
      foreground:
        xtermTheme?.foreground ??
        cssTokens['--cove-terminal-foreground'] ??
        fallbackTheme.foreground,
      cursor: xtermTheme?.cursor ?? cssTokens['--cove-terminal-cursor'] ?? fallbackTheme.cursor,
      selectionBackground:
        xtermTheme?.selectionBackground ??
        cssTokens['--cove-terminal-selection'] ??
        fallbackTheme.selectionBackground,
    },
    cssTokens,
  })
}

function normalizeSourceClasses(sourceScope: Element | null): string {
  const classes = sourceScope?.getAttribute('class')?.split(/\s+/).filter(Boolean) ?? []
  classes.push('terminal-node')
  return Array.from(new Set(classes)).sort().join(' ')
}

const desiredAppearanceCache = new Map<string, TerminalAppearanceValue>()
let desiredAppearanceCacheClearScheduled = false

function scheduleDesiredAppearanceCacheClear(): void {
  if (desiredAppearanceCacheClearScheduled) {
    return
  }
  desiredAppearanceCacheClearScheduled = true
  queueMicrotask(() => {
    desiredAppearanceCache.clear()
    desiredAppearanceCacheClearScheduled = false
  })
}

export function resolveDesiredTerminalAppearanceValue({
  terminalThemeMode,
  sourceScope = null,
}: {
  terminalThemeMode: TerminalThemeMode
  sourceScope?: Element | null
}): TerminalAppearanceValue {
  const sourceClasses = normalizeSourceClasses(sourceScope)
  const cacheKey = [
    resolveActiveUiThemeId(),
    resolveActiveUiTheme(),
    terminalThemeMode,
    sourceClasses,
  ].join('|')
  const cached = desiredAppearanceCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const probe = document.createElement('div')
  probe.className = sourceClasses
  probe.hidden = true
  probe.setAttribute('aria-hidden', 'true')
  probe.setAttribute('data-cove-terminal-theme-probe', '')
  probe.setAttribute('data-cove-terminal-node-theme', resolveTerminalUiTheme(terminalThemeMode))

  const host = document.body ?? document.documentElement
  host.appendChild(probe)
  try {
    const appearance = resolveCurrentTerminalAppearanceValue({
      terminalThemeMode,
      scope: probe,
    })
    desiredAppearanceCache.set(cacheKey, appearance)
    scheduleDesiredAppearanceCacheClear()
    return appearance
  } finally {
    probe.remove()
  }
}

export function publishTerminalAppearanceSnapshot(
  container: HTMLDivElement | null,
  snapshot: TerminalAppearanceSnapshot,
): void {
  const terminalNode = container?.closest('.terminal-node')
  container?.setAttribute('data-cove-terminal-theme', snapshot.terminalScheme)
  terminalNode?.setAttribute('data-cove-terminal-node-theme', snapshot.terminalScheme)
  if (!(terminalNode instanceof HTMLElement)) {
    return
  }

  TERMINAL_APPEARANCE_CSS_VARIABLES.forEach(variable => {
    const value = snapshot.cssTokens[variable]
    if (typeof value === 'string' && value.length > 0) {
      terminalNode.style.setProperty(variable, value)
    } else {
      terminalNode.style.removeProperty(variable)
    }
  })
}

export function createTerminalAppearanceOwner(
  initialValue: TerminalAppearanceValue,
  options: {
    initiallyApplied?: boolean
    onApplied?: (snapshot: TerminalAppearanceSnapshot) => void
  } = {},
): TerminalAppearanceOwner {
  let revision = 1
  let desiredSnapshot = freezeSnapshot(revision, initialValue)
  let appliedSnapshot = options.initiallyApplied === true ? desiredSnapshot : null
  const appliedListeners = new Set<(snapshot: TerminalAppearanceSnapshot) => void>()

  return {
    getDesiredSnapshot: () => desiredSnapshot,
    getAppliedSnapshot: () => appliedSnapshot,
    update: value => {
      if (appearanceValuesEqual(desiredSnapshot, value)) {
        return desiredSnapshot
      }

      revision += 1
      desiredSnapshot = freezeSnapshot(revision, value)
      return desiredSnapshot
    },
    markApplied: snapshot => {
      if (
        snapshot !== desiredSnapshot ||
        (appliedSnapshot !== null && snapshot.revision <= appliedSnapshot.revision)
      ) {
        return false
      }

      appliedSnapshot = snapshot
      options.onApplied?.(snapshot)
      appliedListeners.forEach(listener => listener(snapshot))
      return true
    },
    subscribeApplied: listener => {
      appliedListeners.add(listener)
      return () => {
        appliedListeners.delete(listener)
      }
    },
  }
}

const appearanceOwners = new WeakMap<Terminal, TerminalAppearanceOwner>()
const terminalAppliedListeners = new Set<
  (terminal: Terminal, snapshot: TerminalAppearanceSnapshot) => void
>()

export function getOrCreateTerminalAppearanceOwner(
  terminal: Terminal,
  initialValue: TerminalAppearanceValue,
  options: { initiallyApplied?: boolean } = {},
): TerminalAppearanceOwner {
  const existing = appearanceOwners.get(terminal)
  if (existing) {
    return existing
  }

  const owner = createTerminalAppearanceOwner(initialValue, {
    initiallyApplied: options.initiallyApplied ?? true,
    onApplied: snapshot => {
      terminalAppliedListeners.forEach(listener => listener(terminal, snapshot))
    },
  })
  appearanceOwners.set(terminal, owner)
  return owner
}

export function getTerminalAppearanceOwner(terminal: Terminal): TerminalAppearanceOwner | null {
  return appearanceOwners.get(terminal) ?? null
}

export function getTerminalAppliedAppearance(
  terminal: Terminal,
): TerminalAppearanceSnapshot | null {
  return appearanceOwners.get(terminal)?.getAppliedSnapshot() ?? null
}

export function subscribeTerminalAppliedAppearance(
  listener: (terminal: Terminal, snapshot: TerminalAppearanceSnapshot) => void,
): () => void {
  terminalAppliedListeners.add(listener)
  return () => {
    terminalAppliedListeners.delete(listener)
  }
}

export interface TerminalAppearanceRefreshCoordinator {
  request: (snapshot: TerminalAppearanceSnapshot) => void
  flushNow: () => void
  setVisible: (visible: boolean) => void
  dispose: () => void
}

export function createTerminalAppearanceRefreshCoordinator({
  owner,
  apply,
  clearTextureAtlas,
  refresh,
  inspect,
  requestFrame = callback => window.requestAnimationFrame(callback),
  cancelFrame = handle => window.cancelAnimationFrame(handle),
}: {
  owner: TerminalAppearanceOwner
  apply: (snapshot: TerminalAppearanceSnapshot) => void
  clearTextureAtlas?: (snapshot: TerminalAppearanceSnapshot) => void
  refresh: (snapshot: TerminalAppearanceSnapshot) => void
  inspect?: (snapshot: TerminalAppearanceSnapshot) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}): TerminalAppearanceRefreshCoordinator {
  let pendingSnapshot: TerminalAppearanceSnapshot | null = null
  let applyFrame: number | null = null
  let inspectFrame: number | null = null
  let visible = true
  let disposed = false
  let retriedFailedRevision: number | null = null

  const cancelInspect = (): void => {
    if (inspectFrame === null) {
      return
    }
    cancelFrame(inspectFrame)
    inspectFrame = null
  }

  const flush = (): void => {
    applyFrame = null
    if (disposed) {
      return
    }

    const snapshot = pendingSnapshot
    pendingSnapshot = null
    if (!snapshot || owner.getAppliedSnapshot()?.revision === snapshot.revision) {
      return
    }

    try {
      apply(snapshot)
      clearTextureAtlas?.(snapshot)
      refresh(snapshot)
    } catch {
      if (retriedFailedRevision !== snapshot.revision && snapshot === owner.getDesiredSnapshot()) {
        retriedFailedRevision = snapshot.revision
        pendingSnapshot = snapshot
        schedule()
      }
      return
    }
    if (!owner.markApplied(snapshot)) {
      return
    }
    retriedFailedRevision = null

    if (inspect) {
      cancelInspect()
      inspectFrame = requestFrame(() => {
        inspectFrame = null
        if (!disposed && owner.getAppliedSnapshot()?.revision === snapshot.revision) {
          inspect(snapshot)
        }
      })
    }
  }

  const schedule = (): void => {
    if (disposed || !visible || applyFrame !== null || pendingSnapshot === null) {
      return
    }
    applyFrame = requestFrame(flush)
  }

  return {
    request: snapshot => {
      if (
        disposed ||
        snapshot !== owner.getDesiredSnapshot() ||
        snapshot.revision <= (owner.getAppliedSnapshot()?.revision ?? 0) ||
        snapshot.revision <= (pendingSnapshot?.revision ?? 0)
      ) {
        return
      }
      pendingSnapshot = snapshot
      cancelInspect()
      schedule()
    },
    flushNow: () => {
      if (applyFrame !== null) {
        cancelFrame(applyFrame)
      }
      flush()
    },
    setVisible: nextVisible => {
      visible = nextVisible
      if (!visible && applyFrame !== null) {
        cancelFrame(applyFrame)
        applyFrame = null
        return
      }
      schedule()
    },
    dispose: () => {
      disposed = true
      pendingSnapshot = null
      if (applyFrame !== null) {
        cancelFrame(applyFrame)
        applyFrame = null
      }
      cancelInspect()
    },
  }
}
