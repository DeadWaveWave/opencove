import React, { useCallback, useEffect, useState } from 'react'
import type { WorkspaceDirectory } from '@shared/contracts/dto'
import { AddProjectDialog } from './AddProjectDialog'
import {
  WORKSPACE_SELECT_DIRECTORY_REQUEST_EVENT,
  WORKSPACE_SELECT_DIRECTORY_RESPONSE_EVENT,
  type WorkspaceSelectDirectoryRequestDetail,
} from '../../workspaceDirectoryPickerEvents'

export function WorkspaceDirectoryPickerBridge(): React.JSX.Element | null {
  const [requestId, setRequestId] = useState<string | null>(null)

  useEffect(() => {
    const runtime = window.opencoveApi?.meta?.runtime ?? 'electron'
    if (runtime !== 'browser') {
      return
    }

    const handler = (event: Event) => {
      const detail = (event as CustomEvent<WorkspaceSelectDirectoryRequestDetail>).detail
      if (!detail || typeof detail.requestId !== 'string' || detail.requestId.length === 0) {
        return
      }

      setRequestId(detail.requestId)
    }

    window.addEventListener(WORKSPACE_SELECT_DIRECTORY_REQUEST_EVENT, handler as EventListener)
    return () => {
      window.removeEventListener(WORKSPACE_SELECT_DIRECTORY_REQUEST_EVENT, handler as EventListener)
    }
  }, [])

  const resolveRequest = useCallback(
    (directory: WorkspaceDirectory | null) => {
      const currentRequestId = requestId
      if (!currentRequestId) {
        setRequestId(null)
        return
      }

      try {
        window.dispatchEvent(
          new CustomEvent(WORKSPACE_SELECT_DIRECTORY_RESPONSE_EVENT, {
            detail: { requestId: currentRequestId, directory },
          }),
        )
      } catch {
        // ignore dispatch errors
      } finally {
        setRequestId(null)
      }
    },
    [requestId],
  )

  if (!requestId) {
    return null
  }

  return (
    <AddProjectDialog
      onCancel={() => {
        resolveRequest(null)
      }}
      onConfirm={directory => {
        resolveRequest(directory)
      }}
    />
  )
}
