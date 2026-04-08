import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type {
  ListWorkerEndpointsResult,
  PingWorkerEndpointResult,
  WorkerEndpointDto,
} from '@shared/contracts/dto'
import { toErrorMessage } from './workerSectionUtils'
import { notifyTopologyChanged } from '@app/renderer/shell/utils/topologyEvents'

type PingState =
  | { status: 'idle'; result: PingWorkerEndpointResult | null }
  | { status: 'busy'; result: PingWorkerEndpointResult | null }

export function EndpointsSection(): React.JSX.Element {
  const { t } = useTranslation()
  const [endpoints, setEndpoints] = useState<WorkerEndpointDto[]>([])
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [registerHostname, setRegisterHostname] = useState('')
  const [registerPort, setRegisterPort] = useState('')
  const [registerDisplayName, setRegisterDisplayName] = useState('')
  const registerTokenRef = useRef<HTMLInputElement | null>(null)
  const [pingByEndpointId, setPingByEndpointId] = useState<Record<string, PingState>>({})

  const canRegister = useMemo(() => {
    const hostname = registerHostname.trim()
    const port = Number(registerPort)
    return hostname.length > 0 && Number.isFinite(port) && port > 0 && port <= 65_535
  }, [registerHostname, registerPort])

  const load = async (): Promise<void> => {
    const result = await window.opencoveApi.controlSurface.invoke<ListWorkerEndpointsResult>({
      kind: 'query',
      id: 'endpoint.list',
      payload: null,
    })
    setEndpoints(result.endpoints)
  }

  useEffect(() => {
    void (async () => {
      try {
        await load()
      } catch (caughtError) {
        setError(toErrorMessage(caughtError))
      }
    })()
  }, [])

  const handleRegister = async (): Promise<void> => {
    if (!canRegister) {
      return
    }

    const token = registerTokenRef.current?.value.trim() ?? ''
    if (token.length === 0) {
      setError(t('settingsPanel.endpoints.register.tokenRequired'))
      return
    }

    setError(null)
    setIsBusy(true)

    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'endpoint.register',
        payload: {
          displayName: registerDisplayName.trim().length > 0 ? registerDisplayName.trim() : null,
          hostname: registerHostname.trim(),
          port: Number(registerPort),
          token,
        },
      })

      if (registerTokenRef.current) {
        registerTokenRef.current.value = ''
      }

      setRegisterHostname('')
      setRegisterPort('')
      setRegisterDisplayName('')
      await load()
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const handleRemove = async (endpointId: string): Promise<void> => {
    setError(null)
    setIsBusy(true)
    try {
      await window.opencoveApi.controlSurface.invoke({
        kind: 'command',
        id: 'endpoint.remove',
        payload: { endpointId },
      })
      await load()
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }

  const handlePing = async (endpointId: string): Promise<void> => {
    setError(null)
    setPingByEndpointId(prev => ({
      ...prev,
      [endpointId]: { status: 'busy', result: prev[endpointId]?.result ?? null },
    }))

    try {
      const result = await window.opencoveApi.controlSurface.invoke<PingWorkerEndpointResult>({
        kind: 'query',
        id: 'endpoint.ping',
        payload: { endpointId, timeoutMs: 5_000 },
      })
      setPingByEndpointId(prev => ({
        ...prev,
        [endpointId]: { status: 'idle', result },
      }))
    } catch (caughtError) {
      setPingByEndpointId(prev => ({
        ...prev,
        [endpointId]: { status: 'idle', result: prev[endpointId]?.result ?? null },
      }))
      setError(toErrorMessage(caughtError))
    }
  }

  return (
    <div className="settings-panel__section" id="settings-section-endpoints">
      <h3 className="settings-panel__section-title">{t('settingsPanel.endpoints.title')}</h3>

      {error ? (
        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('common.error')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value" style={{ color: 'var(--cove-danger-text)' }}>
              {error}
            </span>
          </div>
        </div>
      ) : null}

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">
            {t('settingsPanel.endpoints.list.title')}
          </h4>
          <span>{t('settingsPanel.endpoints.list.help')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.endpoints.list.countLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <span className="settings-panel__value">{String(endpoints.length)}</span>
            <button
              type="button"
              className="secondary"
              data-testid="settings-endpoints-refresh"
              disabled={isBusy}
              onClick={async () => {
                setError(null)
                setIsBusy(true)
                try {
                  await load()
                } catch (caughtError) {
                  setError(toErrorMessage(caughtError))
                } finally {
                  setIsBusy(false)
                }
              }}
            >
              {t('common.refresh')}
            </button>
          </div>
        </div>

        {endpoints.map(endpoint => {
          const pingState = pingByEndpointId[endpoint.endpointId] ?? {
            status: 'idle' as const,
            result: null,
          }
          const canRemove = endpoint.endpointId !== 'local'
          const subtitle = endpoint.remote
            ? `${endpoint.remote.hostname}:${String(endpoint.remote.port)}`
            : t('settingsPanel.endpoints.list.localSubtitle')

          return (
            <div key={endpoint.endpointId} className="settings-panel__row">
              <div className="settings-panel__row-label">
                <strong>{endpoint.displayName}</strong>
                <span>
                  {subtitle} · {endpoint.kind}
                </span>
                {pingState.result ? (
                  <span className="settings-panel__hint">
                    {t('settingsPanel.endpoints.list.lastPing', {
                      pid: pingState.result.pid,
                      now: pingState.result.now,
                    })}
                  </span>
                ) : null}
              </div>
              <div className="settings-panel__control">
                <button
                  type="button"
                  className="secondary"
                  data-testid={`settings-endpoints-ping-${endpoint.endpointId}`}
                  disabled={isBusy || pingState.status === 'busy'}
                  onClick={() => {
                    void handlePing(endpoint.endpointId)
                  }}
                >
                  {pingState.status === 'busy'
                    ? t('settingsPanel.endpoints.actions.pinging')
                    : t('settingsPanel.endpoints.actions.ping')}
                </button>
                <button
                  type="button"
                  className="secondary"
                  data-testid={`settings-endpoints-remove-${endpoint.endpointId}`}
                  disabled={isBusy || !canRemove}
                  onClick={() => {
                    void handleRemove(endpoint.endpointId)
                  }}
                  title={canRemove ? undefined : t('settingsPanel.endpoints.list.localRemoveHelp')}
                >
                  {t('common.remove')}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <div className="settings-panel__subsection">
        <div className="settings-panel__subsection-header">
          <h4 className="settings-panel__section-title">
            {t('settingsPanel.endpoints.register.title')}
          </h4>
          <span>{t('settingsPanel.endpoints.register.help')}</span>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.endpoints.register.displayNameLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <input
              className="cove-field"
              style={{ width: '100%' }}
              type="text"
              value={registerDisplayName}
              onChange={event => setRegisterDisplayName(event.target.value)}
              data-testid="settings-endpoints-register-displayName"
              disabled={isBusy}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.endpoints.register.hostnameLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <input
              className="cove-field"
              style={{ width: '100%' }}
              type="text"
              value={registerHostname}
              onChange={event => setRegisterHostname(event.target.value)}
              data-testid="settings-endpoints-register-hostname"
              disabled={isBusy}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.endpoints.register.portLabel')}</strong>
          </div>
          <div className="settings-panel__control">
            <input
              className="cove-field"
              style={{ width: '100%' }}
              type="text"
              inputMode="numeric"
              value={registerPort}
              onChange={event => setRegisterPort(event.target.value)}
              data-testid="settings-endpoints-register-port"
              disabled={isBusy}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label">
            <strong>{t('settingsPanel.endpoints.register.tokenLabel')}</strong>
            <span>{t('settingsPanel.endpoints.register.tokenHelp')}</span>
          </div>
          <div className="settings-panel__control">
            <input
              ref={registerTokenRef}
              className="cove-field"
              style={{ width: '100%' }}
              type="password"
              data-testid="settings-endpoints-register-token"
              disabled={isBusy}
            />
          </div>
        </div>

        <div className="settings-panel__row">
          <div className="settings-panel__row-label"></div>
          <div className="settings-panel__control">
            <button
              type="button"
              className="primary"
              data-testid="settings-endpoints-register-submit"
              disabled={isBusy || !canRegister}
              onClick={() => {
                void handleRegister()
              }}
            >
              {isBusy ? t('common.saving') : t('common.add')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
