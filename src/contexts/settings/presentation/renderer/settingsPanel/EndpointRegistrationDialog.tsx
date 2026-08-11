import React, { useEffect, useState } from 'react'
import type {
  RegisterManagedSshWorkerEndpointResult,
  RegisterWorkerEndpointResult,
} from '@shared/contracts/dto'
import { parseOptionalManagedSshPort } from '../../../../topology/domain/managedSshPort'
import { notifyTopologyChanged } from '@app/renderer/shell/utils/topologyEvents'
import { EndpointsRegisterDialog } from './EndpointsRegisterDialog'
import { toErrorMessage } from './workerSectionUtils'

type RegisterMode = 'managed' | 'manual'

function parseRequiredPort(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) {
    return null
  }

  const port = Number(trimmed)
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : null
}

export function EndpointRegistrationDialog({
  isOpen,
  returnFocus,
  onCancel,
  onRegistered,
}: {
  isOpen: boolean
  returnFocus?: React.RefObject<HTMLElement | null> | false
  onCancel: () => void
  onRegistered: (endpointId: string) => Promise<void>
}): React.JSX.Element | null {
  const [registerMode, setRegisterMode] = useState<RegisterMode>('managed')
  const [displayName, setDisplayName] = useState('')
  const [managedHost, setManagedHost] = useState('')
  const [managedPort, setManagedPort] = useState('')
  const [managedUsername, setManagedUsername] = useState('')
  const [managedRemotePort, setManagedRemotePort] = useState('')
  const [manualHostname, setManualHostname] = useState('')
  const [manualPort, setManualPort] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [registeredEndpointId, setRegisteredEndpointId] = useState<string | null>(null)
  const mountedRef = React.useRef(true)

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    [],
  )

  const managedPortResult = parseOptionalManagedSshPort(managedPort)
  const managedRemotePortResult = parseOptionalManagedSshPort(managedRemotePort)
  const manualPortValue = parseRequiredPort(manualPort)
  const canRegisterManaged =
    managedHost.trim().length > 0 &&
    managedPortResult.state !== 'invalid' &&
    managedRemotePortResult.state !== 'invalid'
  const canRegisterManual =
    manualHostname.trim().length > 0 && manualPortValue !== null && manualToken.trim().length > 0

  const resetForm = (): void => {
    setRegisterMode('managed')
    setDisplayName('')
    setManagedHost('')
    setManagedPort('')
    setManagedUsername('')
    setManagedRemotePort('')
    setManualHostname('')
    setManualPort('')
    setManualToken('')
    setError(null)
    setRegisteredEndpointId(null)
  }

  const handleCancel = (): void => {
    if (isBusy) {
      return
    }

    resetForm()
    onCancel()
  }

  const handleSubmit = async (): Promise<void> => {
    if (isBusy) {
      return
    }
    if (registeredEndpointId === null && registerMode === 'managed' && !canRegisterManaged) {
      return
    }
    if (
      registeredEndpointId === null &&
      registerMode === 'manual' &&
      (!canRegisterManual || manualPortValue === null)
    ) {
      return
    }

    setError(null)
    setIsBusy(true)
    try {
      let endpointId = registeredEndpointId
      if (endpointId === null) {
        endpointId =
          registerMode === 'managed'
            ? (
                await window.opencoveApi.controlSurface.invoke<RegisterManagedSshWorkerEndpointResult>(
                  {
                    kind: 'command',
                    id: 'endpoint.registerManagedSsh',
                    payload: {
                      displayName: displayName.trim().length > 0 ? displayName.trim() : null,
                      host: managedHost.trim(),
                      port: managedPortResult.value,
                      username: managedUsername.trim().length > 0 ? managedUsername.trim() : null,
                      remotePort: managedRemotePortResult.value,
                      remotePlatform: 'auto',
                    },
                  },
                )
              ).endpoint.endpointId
            : (
                await window.opencoveApi.controlSurface.invoke<RegisterWorkerEndpointResult>({
                  kind: 'command',
                  id: 'endpoint.register',
                  payload: {
                    displayName: displayName.trim().length > 0 ? displayName.trim() : null,
                    hostname: manualHostname.trim(),
                    port: manualPortValue,
                    token: manualToken.trim(),
                  },
                })
              ).endpoint.endpointId
        setRegisteredEndpointId(endpointId)
        notifyTopologyChanged()
      }

      if (!mountedRef.current) {
        return
      }

      const registeredId = endpointId
      if (registeredId === null) {
        return
      }

      await onRegistered(registeredId)
      if (mountedRef.current) {
        resetForm()
      }
    } catch (caughtError) {
      if (mountedRef.current) {
        setError(toErrorMessage(caughtError))
      }
    } finally {
      if (mountedRef.current) {
        setIsBusy(false)
      }
    }
  }

  return (
    <EndpointsRegisterDialog
      isOpen={isOpen}
      mode="create"
      error={error}
      isBusy={isBusy}
      registerMode={registerMode}
      displayName={displayName}
      managedHost={managedHost}
      managedUsername={managedUsername}
      managedPort={managedPort}
      managedRemotePort={managedRemotePort}
      manualHostname={manualHostname}
      manualPort={manualPort}
      manualToken={manualToken}
      canSubmit={registerMode === 'managed' ? canRegisterManaged : canRegisterManual}
      managedPortInvalid={managedPortResult.state === 'invalid'}
      managedRemotePortInvalid={managedRemotePortResult.state === 'invalid'}
      returnFocus={returnFocus}
      onChangeRegisterMode={setRegisterMode}
      onChangeDisplayName={setDisplayName}
      onChangeManagedHost={setManagedHost}
      onChangeManagedUsername={setManagedUsername}
      onChangeManagedPort={setManagedPort}
      onChangeManagedRemotePort={setManagedRemotePort}
      onChangeManualHostname={setManualHostname}
      onChangeManualPort={setManualPort}
      onChangeManualToken={setManualToken}
      onCancel={handleCancel}
      onSubmit={() => {
        void handleSubmit()
      }}
    />
  )
}
