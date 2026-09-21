import { isTerminalLoopbackHost } from '@contexts/terminal/domain/links/terminalLoopbackHost'
import React, { useEffect, useRef, useState } from 'react'
import { TerminalLinkSurface } from './TerminalLinkSurface'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import { useTranslation } from '@app/renderer/i18n'
import {
  resolveTerminalLinkTarget,
  type TerminalLinkSourceContext,
  type TerminalLinkTargetResolution,
  type TerminalResolvedFileTarget,
} from '@contexts/terminal/application/links/resolveTerminalLinkTarget'
import type { NodeWorkerBinding } from '@shared/types/nodeWorkerBinding'
import type { TerminalFileLinkOpenRequest } from '@shared/types/terminalLinkNavigation'
import {
  copyTerminalLink,
  canOpenTerminalTargetWithSystem,
  openTerminalTargetWithSystem,
  getTerminalLinkEnvironment,
  getTerminalSystemOpenCapability,
  openTerminalUrl,
  statTerminalLink,
} from '../../../utils/terminalLinkApi'
import {
  TERMINAL_LINK_EVENT,
  TERMINAL_LINK_INVALIDATION_EVENT,
  type TerminalLinkIntent,
} from './linkHostEvent'

export interface TerminalLinkHostOptions {
  executionDirectory?: string | null
  workerBinding?: NodeWorkerBinding | null
  onOpenFileLink?: (request: TerminalFileLinkOpenRequest) => Promise<boolean>
}
interface LinkView {
  intent: TerminalLinkIntent
  resolution?: TerminalLinkTargetResolution
  error?: 'open_failed' | 'destination' | 'forbidden'
  hasLocalSystemAccess?: boolean
}

async function openFileTarget(
  target: TerminalResolvedFileTarget,
  options: TerminalLinkHostOptions,
  hasLocalSystemAccess: boolean,
  preferSystem = false,
): Promise<boolean> {
  if (
    (preferSystem || target.kind === 'directory') &&
    canOpenTerminalTargetWithSystem(target, hasLocalSystemAccess)
  ) {
    return openTerminalTargetWithSystem(target, hasLocalSystemAccess)
  }
  if (preferSystem) {
    return false
  }
  return options.onOpenFileLink?.({ ...target, mountId: target.mountId ?? null }) ?? false
}

function openError(error: unknown): NonNullable<LinkView['error']> {
  const descriptor = toAppErrorDescriptor(error)
  return descriptor.code === 'common.approved_path_required' ||
    descriptor.params?.reason === 'forbidden'
    ? 'forbidden'
    : 'open_failed'
}

export function TerminalLinkHost({
  containerRef,
  sessionId,
  options,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>
  sessionId: string
  options: TerminalLinkHostOptions
}) {
  const { t } = useTranslation()
  const [view, setView] = useState<LinkView | null>(null)
  const latest = useRef(options)
  latest.current = options
  const viewRef = useRef(view)
  viewRef.current = view
  const requestId = useRef(0)
  const close = (restore = false) => {
    requestId.current++
    setView(null)
    if (restore) {
      view?.intent.focusTerminal()
    }
  }
  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return
    }
    let alive = true
    const invalidateRequest = () => {
      requestId.current++
    }
    invalidateRequest()
    setView(null)
    const endpointId = options.workerBinding?.endpointId ?? 'local'
    container.dataset.coveSourceKey = JSON.stringify([
      sessionId,
      endpointId,
      options.workerBinding?.mountId ?? null,
      options.executionDirectory ?? null,
    ])
    const environment = getTerminalLinkEnvironment(endpointId)
    const systemCapability = getTerminalSystemOpenCapability()
    const inferredPlatform = /^(?:[a-z]:[\\/]|\\\\)/i.test(options.executionDirectory ?? '')
      ? 'windows'
      : 'posix'
    container.dataset.coveSourcePlatform = inferredPlatform
    void environment.then(value => {
      if (alive && value) {
        container.dataset.coveSourcePlatform = value.platform
        if (value.hostname) {
          container.dataset.coveSourceHostname = value.hostname
        }
      }
    })
    const execute = async (
      resolution: TerminalLinkTargetResolution,
      intent: TerminalLinkIntent,
      id: number,
      hasLocalSystemAccess: boolean,
    ) => {
      if (
        !alive ||
        id !== requestId.current ||
        !intent.isCurrent() ||
        resolution.status === 'unresolved'
      ) {
        return
      }
      if (resolution.target.kind === 'url') {
        openTerminalUrl(resolution.target.uri)
        setView(null)
        return
      }
      const opened = await openFileTarget(
        resolution.target,
        latest.current,
        hasLocalSystemAccess,
        intent.preferSystem,
      )
      if (alive && id === requestId.current && intent.isCurrent()) {
        setView(opened ? null : { intent, resolution, hasLocalSystemAccess, error: 'destination' })
      }
    }
    const handle = (event: Event) => {
      const intent = (event as CustomEvent<TerminalLinkIntent>).detail
      if (!intent?.isCurrent()) {
        return
      }
      if (intent.action === 'leave') {
        setView(old => (old?.intent.action === 'hover' ? null : old))
        return
      }
      if (intent.action === 'hover') {
        setView(old => (old && old.intent.action !== 'hover' ? old : { intent }))
        return
      }
      const id = ++requestId.current
      // HTTP activation stays in the browser user-gesture stack.
      if (intent.target.kind === 'url') {
        try {
          const url = new URL(intent.target.uri)
          if (!['http:', 'https:'].includes(url.protocol)) {
            return
          }
          const remoteLoopback = endpointId !== 'local' && isTerminalLoopbackHost(url.hostname)
          const resolution: TerminalLinkTargetResolution = remoteLoopback
            ? { status: 'unresolved', reason: 'unavailable' }
            : { status: 'resolved', target: intent.target }
          if (intent.action === 'open' && !remoteLoopback) {
            openTerminalUrl(intent.target.uri)
            setView(null)
          } else {
            setView({ intent, resolution })
          }
        } catch {
          setView({ intent, error: 'open_failed' })
        }
        return
      }
      setView({ intent })
      void Promise.all([environment, systemCapability])
        .then(async ([env, hasLocalSystemAccess]) => {
          const source: TerminalLinkSourceContext = {
            endpointId,
            mountId: options.workerBinding?.mountId ?? undefined,
            cwd: intent.observedCwd ?? options.executionDirectory ?? undefined,
            cwdSource: intent.observedCwd
              ? 'observed'
              : options.executionDirectory
                ? 'launch'
                : 'unknown',
            platform: env?.platform ?? inferredPlatform,
            home: env?.home,
          }
          const target = intent.target
          if (target.kind !== 'file') {
            return
          }
          const resolution = await resolveTerminalLinkTarget(
            { ...target, rawTarget: target.path },
            source,
            statTerminalLink,
          )
          if (!alive || id !== requestId.current || !intent.isCurrent()) {
            return
          }
          if (intent.action === 'open' && resolution.status === 'resolved') {
            await execute(resolution, intent, id, hasLocalSystemAccess)
          } else {
            setView({ intent, resolution, hasLocalSystemAccess })
          }
        })
        .catch(error => {
          if (alive && id === requestId.current && intent.isCurrent()) {
            setView(old =>
              old ? { ...old, error: openError(error) } : { intent, error: openError(error) },
            )
          }
        })
    }
    const invalidate = () => {
      if (viewRef.current && !viewRef.current.intent.isCurrent()) {
        requestId.current++
        setView(null)
      }
    }
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.terminal-link-card')) {
        return
      }
      requestId.current++
      setView(null)
    }
    const escape = (event: KeyboardEvent) => {
      const active = viewRef.current
      if (!active || active.intent.action === 'hover') {
        return
      }
      if (
        (event.key === 'Tab' || event.key === 'ArrowDown') &&
        !(
          document.activeElement instanceof Element &&
          document.activeElement.closest('.terminal-link-card')
        )
      ) {
        const first =
          document.querySelector<HTMLButtonElement>(
            '[data-terminal-link-primary]:not(:disabled)',
          ) ??
          document.querySelector<HTMLButtonElement>('.terminal-link-card button:not(:disabled)')
        if (first) {
          event.preventDefault()
          event.stopPropagation()
          first.focus()
        }
        return
      }
      if (event.key !== 'Escape') {
        return
      }
      event.preventDefault()
      event.stopPropagation()
      requestId.current++
      setView(null)
      active.intent.focusTerminal()
    }
    container.addEventListener(TERMINAL_LINK_EVENT, handle)
    container.addEventListener(TERMINAL_LINK_INVALIDATION_EVENT, invalidate)
    document.addEventListener('pointerdown', dismiss, true)
    document.addEventListener('keydown', escape, true)
    return () => {
      alive = false
      invalidateRequest()
      container.removeEventListener(TERMINAL_LINK_EVENT, handle)
      container.removeEventListener(TERMINAL_LINK_INVALIDATION_EVENT, invalidate)
      document.removeEventListener('pointerdown', dismiss, true)
      document.removeEventListener('keydown', escape, true)
      delete container.dataset.coveSourceKey
      delete container.dataset.coveSourcePlatform
      delete container.dataset.coveSourceHostname
    }
  }, [
    containerRef,
    sessionId,
    options.executionDirectory,
    options.workerBinding?.endpointId,
    options.workerBinding?.mountId,
  ])
  if (!view) {
    return null
  }
  const { intent, resolution } = view
  const hover = intent.action === 'hover'
  const target = resolution && resolution.status !== 'unresolved' ? resolution.target : null
  const label = target
    ? target.kind === 'url'
      ? target.uri
      : target.path
    : intent.target.kind === 'url'
      ? intent.target.uri
      : intent.target.path
  const failure = resolution?.status === 'unresolved' ? resolution.reason : null
  const message = view.error
    ? t(
        view.error === 'forbidden'
          ? 'terminalLink.forbidden'
          : view.error === 'destination'
            ? 'terminalLink.noDestination'
            : 'terminalLink.openFailed',
      )
    : failure === 'not_found'
      ? t('terminalLink.notFound')
      : failure === 'forbidden'
        ? t('terminalLink.forbidden')
        : failure
          ? t('terminalLink.unavailable')
          : resolution?.status === 'confirmation_required'
            ? t('terminalLink.confirmDirectory')
            : !resolution && !hover
              ? t('terminalLink.resolving')
              : null
  const open = async (preferSystem = false) => {
    if (!target || !intent.isCurrent()) {
      close()
      return
    }
    const id = ++requestId.current
    if (target.kind === 'url') {
      try {
        close(true)
        openTerminalUrl(target.uri)
      } catch (error) {
        setView({ ...view, error: openError(error) })
      }
      return
    }
    try {
      const verified = await statTerminalLink(target)
      if (id !== requestId.current || !intent.isCurrent()) {
        return
      }
      if (verified && 'reason' in verified) {
        setView({ ...view, resolution: { status: 'unresolved', reason: verified.reason } })
        return
      }
      if (!verified || verified.kind !== target.kind) {
        setView({ ...view, error: 'open_failed' })
        return
      }
      setView(null)
      intent.focusTerminal()
      const opened = await openFileTarget(
        target,
        latest.current,
        view.hasLocalSystemAccess === true,
        preferSystem,
      )
      if (id === requestId.current && intent.isCurrent()) {
        setView(opened ? null : { ...view, error: 'destination' })
      }
    } catch (error) {
      if (id === requestId.current && intent.isCurrent()) {
        setView({ ...view, error: openError(error) })
      }
    }
  }
  const kind = target?.kind ?? intent.target.kind
  const system =
    target &&
    target.kind !== 'url' &&
    canOpenTerminalTargetWithSystem(target, view.hasLocalSystemAccess === true)
  const primaryLabel =
    kind === 'url'
      ? t('terminalLink.openBrowser')
      : kind === 'directory'
        ? t(
            system
              ? /mac/i.test(navigator.platform)
                ? 'terminalLink.openFinder'
                : 'terminalLink.openFolder'
              : 'terminalLink.openExplorer',
          )
        : t('terminalLink.openFile')
  return (
    <TerminalLinkSurface
      intent={intent}
      container={containerRef.current}
      destination={label}
      kind={kind}
      primaryLabel={primaryLabel}
      message={message}
      disabled={!target || !!view.error}
      systemAlternate={!!system && kind === 'file'}
      onOpen={preferSystem => void open(preferSystem)}
      onCopy={() => {
        const id = ++requestId.current
        const current = () => id === requestId.current && intent.isCurrent()
        void copyTerminalLink(label)
          .then(() => {
            if (current()) {
              close(true)
            }
          })
          .catch(() => {
            if (current()) {
              setView({ ...view, error: 'open_failed' })
            }
          })
      }}
    />
  )
}
