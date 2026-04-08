import React, { useCallback, useRef, useState } from 'react'
import type { TranslateFn } from '@app/renderer/i18n'
import type { RegisterWorkerEndpointResult } from '@shared/contracts/dto'
import { toErrorMessage } from '../../utils/format'
import { notifyTopologyChanged } from '../../utils/topologyEvents'

export function AddProjectWizardEndpointRegisterSection({
  t,
  isBusy,
  setIsBusy,
  setError,
  reloadEndpoints,
  onEndpointRegistered,
}: {
  t: TranslateFn
  isBusy: boolean
  setIsBusy: (busy: boolean) => void
  setError: (message: string | null) => void
  reloadEndpoints: () => Promise<void>
  onEndpointRegistered: (endpointId: string) => void
}): React.JSX.Element {
  const [registerEndpointDisplayName, setRegisterEndpointDisplayName] = useState('')
  const [registerEndpointHostname, setRegisterEndpointHostname] = useState('')
  const [registerEndpointPort, setRegisterEndpointPort] = useState('')
  const registerEndpointTokenRef = useRef<HTMLInputElement | null>(null)

  const registerEndpoint = useCallback(async () => {
    const hostname = registerEndpointHostname.trim()
    const port = Number.parseInt(registerEndpointPort.trim(), 10)
    const token = registerEndpointTokenRef.current?.value?.trim() ?? ''
    if (hostname.length === 0 || !Number.isFinite(port) || port <= 0 || token.length === 0) {
      setError(t('addProjectWizard.endpointInvalid'))
      return
    }

    setError(null)
    setIsBusy(true)
    try {
      const result = await window.opencoveApi.controlSurface.invoke<RegisterWorkerEndpointResult>({
        kind: 'command',
        id: 'endpoint.register',
        payload: {
          displayName:
            registerEndpointDisplayName.trim().length > 0
              ? registerEndpointDisplayName.trim()
              : null,
          hostname,
          port,
          token,
        },
      })

      setRegisterEndpointDisplayName('')
      setRegisterEndpointHostname('')
      setRegisterEndpointPort('')
      if (registerEndpointTokenRef.current) {
        registerEndpointTokenRef.current.value = ''
      }

      await reloadEndpoints()
      onEndpointRegistered(result.endpoint.endpointId)
      notifyTopologyChanged()
    } catch (caughtError) {
      setError(toErrorMessage(caughtError))
    } finally {
      setIsBusy(false)
    }
  }, [
    onEndpointRegistered,
    registerEndpointDisplayName,
    registerEndpointHostname,
    registerEndpointPort,
    reloadEndpoints,
    setError,
    setIsBusy,
    t,
  ])

  return (
    <div className="cove-window__field-row">
      <label>{t('addProjectWizard.endpointRegisterLabel')}</label>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
        <input
          className="cove-field"
          type="text"
          value={registerEndpointDisplayName}
          onChange={event => setRegisterEndpointDisplayName(event.target.value)}
          disabled={isBusy}
          placeholder={t('addProjectWizard.endpointDisplayNamePlaceholder')}
          data-testid="workspace-project-create-endpoint-display-name"
        />
        <div style={{ display: 'flex', gap: 8, width: '100%' }}>
          <input
            className="cove-field"
            type="text"
            value={registerEndpointHostname}
            onChange={event => setRegisterEndpointHostname(event.target.value)}
            disabled={isBusy}
            placeholder={t('addProjectWizard.endpointHostnamePlaceholder')}
            data-testid="workspace-project-create-endpoint-hostname"
          />
          <input
            className="cove-field"
            type="text"
            value={registerEndpointPort}
            onChange={event => setRegisterEndpointPort(event.target.value)}
            disabled={isBusy}
            placeholder={t('addProjectWizard.endpointPortPlaceholder')}
            data-testid="workspace-project-create-endpoint-port"
            style={{ width: 110 }}
          />
        </div>
        <input
          className="cove-field"
          type="password"
          ref={registerEndpointTokenRef}
          disabled={isBusy}
          placeholder={t('addProjectWizard.endpointTokenPlaceholder')}
          data-testid="workspace-project-create-endpoint-token"
        />
        <button
          type="button"
          className="cove-window__action cove-window__action--primary"
          disabled={isBusy}
          onClick={() => void registerEndpoint()}
          data-testid="workspace-project-create-endpoint-register"
        >
          {t('addProjectWizard.endpointRegisterAction')}
        </button>
      </div>
    </div>
  )
}
