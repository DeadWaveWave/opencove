import { useCallback, useEffect, useRef, type ReactNode, type RefObject } from 'react'
import { PanelsTopLeft, Settings2, X } from 'lucide-react'
import { IconButton } from '@app/renderer/components/ui/IconButton'
import { cancelPendingFocusRestore } from '@app/renderer/components/ui/Dialog'
import { useTranslation } from '@app/renderer/i18n'

export function SettingsPageFrame({
  children,
  searchInputRef,
  isPreviewing,
  onClose,
}: {
  children: ReactNode
  searchInputRef: RefObject<HTMLInputElement | null>
  isPreviewing: boolean
  onClose: () => void
}) {
  const { t } = useTranslation()
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    let active = true
    // A mobile drawer may unmount in this same commit. Claim focus after its
    // cleanup so its scheduled return cannot steal focus from the page.
    queueMicrotask(() => {
      if (!active) {
        return
      }
      cancelPendingFocusRestore()
      const target = window.matchMedia('(max-width: 720px)').matches
        ? closeRef.current
        : searchInputRef.current
      target?.focus({ preventScroll: true })
    })
    return () => {
      active = false
    }
  }, [searchInputRef])

  const closePage = useCallback(() => {
    onClose()
    // Explicit page closure returns to navigation; sidebar navigation keeps its
    // own focus. Do not restore focus from an unmount cleanup during a handoff.
    window.requestAnimationFrame(() => {
      const selector = window.matchMedia('(max-width: 720px)').matches
        ? '[data-testid="primary-sidebar-open"]'
        : '[data-testid="app-header-settings"]'
      const target = document.querySelector<HTMLElement>(selector)
      if (target && !target.closest('[inert]')) {
        target.focus({ preventScroll: true })
      }
    })
  }, [onClose])

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== 'Escape' ||
        event.defaultPrevented ||
        event.isComposing ||
        (event.target instanceof Element && event.target.closest('.cove-window'))
      ) {
        return
      }
      event.preventDefault()
      closePage()
    }
    // Listen after controls and transient layers. Between a nested dialog's
    // close and focus restoration the event target can temporarily be body.
    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [closePage])

  return (
    <section
      className={`settings-page${isPreviewing ? ' settings-page--preview' : ''}`}
      data-testid="settings-panel"
      aria-label={t('settingsPanel.title')}
    >
      <nav className="settings-page__tabs" aria-label={t('settingsPanel.title')}>
        <button
          type="button"
          className="settings-page__canvas"
          data-testid="settings-page-canvas"
          onClick={closePage}
        >
          <PanelsTopLeft size={15} aria-hidden="true" />
          <span>{t('settingsPanel.canvas.title')}</span>
        </button>
        <div className="settings-page__active-tab" aria-current="page">
          <Settings2 size={15} aria-hidden="true" />
          <span>{t('settingsPanel.title')}</span>
          <IconButton
            ref={closeRef}
            className="settings-panel__close"
            data-testid="settings-panel-close"
            label={t('common.close')}
            onClick={closePage}
          >
            <X size={14} aria-hidden="true" />
          </IconButton>
        </div>
      </nav>
      <div className={`settings-panel${isPreviewing ? ' settings-panel--preview' : ''}`}>
        {children}
      </div>
    </section>
  )
}
