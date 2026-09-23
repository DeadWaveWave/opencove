import React from 'react'
import { WorkspaceDirectoryBreadcrumb } from './WorkspaceDirectoryBreadcrumb'
import type { ShowWorkspaceCanvasMessage } from '../types'
import { useTranslation } from '@app/renderer/i18n'
import { resolveFileUriBreadcrumbs } from '@shared/utils/fileUriScope'

export function WorkspaceDirectoryBrowserNavigation({
  rootUri,
  currentUri,
  onNavigate,
  onShowMessage,
}: {
  rootUri: string
  currentUri: string
  onNavigate: (uri: string) => void
  onShowMessage?: ShowWorkspaceCanvasMessage
}): React.JSX.Element {
  const { t } = useTranslation()
  const breadcrumbsRef = React.useRef<HTMLElement | null>(null)
  const breadcrumbs = resolveFileUriBreadcrumbs(rootUri, currentUri)
  React.useLayoutEffect(() => {
    const element = breadcrumbsRef.current
    if (!element) {
      return
    }
    const revealCurrentDirectory = () => {
      element.scrollLeft = element.scrollWidth
    }
    revealCurrentDirectory()
    const observer = new ResizeObserver(revealCurrentDirectory)
    observer.observe(element)
    return () => observer.disconnect()
  }, [currentUri, rootUri])
  return (
    <div className="cove-directory-browser__navigation nodrag">
      <nav
        ref={breadcrumbsRef}
        className="cove-directory-browser__breadcrumbs"
        aria-label={t('spaceExplorer.path')}
      >
        {breadcrumbs.map((crumb, index) => (
          <React.Fragment key={crumb.uri}>
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            <WorkspaceDirectoryBreadcrumb
              rootUri={rootUri}
              uri={crumb.uri}
              name={crumb.name}
              isCurrent={index === breadcrumbs.length - 1}
              onNavigate={onNavigate}
              onShowMessage={onShowMessage}
            />
          </React.Fragment>
        ))}
      </nav>
    </div>
  )
}
