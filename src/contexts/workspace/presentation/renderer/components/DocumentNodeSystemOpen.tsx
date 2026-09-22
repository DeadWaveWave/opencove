import { useEffect, useLayoutEffect, useRef, useState, type JSX } from 'react'
import { ExternalLink } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { toAppErrorDescriptor } from '@shared/errors/appError'
import {
  canOpenSystemFile,
  openSystemFile,
  type SystemFileReference,
} from '../utils/systemFileOpening'

function SystemOpenAction({ uri, mountId }: SystemFileReference): JSX.Element | null {
  const { t } = useTranslation()
  const [available, setAvailable] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<'forbidden' | 'failed' | null>(null)
  const aliveRef = useRef(false)
  const requestRef = useRef(0)
  const inFlightRef = useRef(false)

  useLayoutEffect(() => {
    aliveRef.current = true
    return () => {
      aliveRef.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void canOpenSystemFile({ uri, mountId })
      .then(result => {
        if (!cancelled && aliveRef.current) {
          setAvailable(result)
        }
      })
      .catch(() => {
        if (!cancelled && aliveRef.current) {
          setAvailable(false)
        }
      })
    return () => {
      cancelled = true
    }
  }, [mountId, uri])

  const open = async (): Promise<void> => {
    if (!available || inFlightRef.current) {
      return
    }
    const requestId = ++requestRef.current
    const isCurrent = () => aliveRef.current && requestId === requestRef.current
    inFlightRef.current = true
    setBusy(true)
    setError(null)
    try {
      const opened = await openSystemFile({ uri, mountId }, isCurrent)
      if (isCurrent() && !opened) {
        setAvailable(false)
      }
    } catch (caught) {
      if (isCurrent()) {
        const descriptor = toAppErrorDescriptor(caught)
        setError(
          descriptor.code === 'common.approved_path_required' ||
            descriptor.params?.reason === 'forbidden'
            ? 'forbidden'
            : 'failed',
        )
      }
    } finally {
      if (isCurrent()) {
        inFlightRef.current = false
        setBusy(false)
      }
    }
  }

  if (!available) {
    return null
  }
  return (
    <div className="document-node__system-open nodrag">
      <button
        type="button"
        className="document-node__state-action document-node__system-open-action nodrag"
        data-testid="document-node-open-system"
        disabled={busy}
        onPointerDown={event => event.stopPropagation()}
        onClick={event => {
          event.stopPropagation()
          void open()
        }}
      >
        <ExternalLink size={14} aria-hidden="true" />
        {t('terminalLink.openWithDefaultApp')}
      </button>
      {error ? (
        <div className="document-node__save-error" role="alert">
          {t(error === 'forbidden' ? 'terminalLink.forbidden' : 'terminalLink.openFailed')}
        </div>
      ) : null}
    </div>
  )
}

export function DocumentNodeSystemOpen(props: SystemFileReference): JSX.Element {
  return <SystemOpenAction key={JSON.stringify([props.uri, props.mountId])} {...props} />
}
