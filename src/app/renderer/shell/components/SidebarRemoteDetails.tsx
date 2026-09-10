import React, { useEffect, useId, useRef, useState } from 'react'
import { Server } from 'lucide-react'
import { useTranslation } from '@app/renderer/i18n'
import { Popover } from '@app/renderer/components/ui/Popover'
import type { WorkspaceMountDetails } from '../hooks/useWorkspaceMountSummaries'

export function SidebarRemoteDetails({
  remote,
  onOpenChange,
}: {
  remote: WorkspaceMountDetails['remote']
  onOpenChange: (open: boolean) => void
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const detailsId = useId()
  useEffect(() => {
    if (!remote) {
      setIsOpen(false)
    }
  }, [remote])
  useEffect(() => {
    onOpenChange(isOpen)
    return () => onOpenChange(false)
  }, [isOpen, onOpenChange])
  if (!remote) {
    return null
  }

  return (
    <>
      <button
        type="button"
        ref={triggerRef}
        className="workspace-sidebar__more workspace-sidebar__remote"
        data-testid="workspace-sidebar-remote"
        aria-label={t('sidebar.remoteProject')}
        aria-expanded={isOpen}
        aria-controls={isOpen ? detailsId : undefined}
        title={`${remote.displayName}\n${remote.rootPath}`}
        onClick={() => setIsOpen(value => !value)}
      >
        <Server size={14} aria-hidden="true" />
      </button>
      <Popover
        open={isOpen}
        anchorRef={triggerRef}
        onDismiss={() => setIsOpen(false)}
        align="end"
        id={detailsId}
        className="workspace-sidebar__remote-details"
        role="note"
      >
        <strong>{remote.displayName}</strong>
        <code>{remote.rootPath}</code>
      </Popover>
    </>
  )
}
