import type { JSX, ReactNode } from 'react'

export function SettingsPanelHeader({
  title,
  description,
  search,
}: {
  title: string
  description: string
  search?: ReactNode
}): JSX.Element {
  return (
    <div className="settings-panel__header">
      <div className="settings-panel__header-copy">
        <h2 id="settings-panel-page-title" data-testid="settings-panel-title">
          {title}
        </h2>
        {description ? (
          <p id="settings-panel-page-description" className="settings-panel__header-description">
            {description}
          </p>
        ) : null}
      </div>
      {search}
    </div>
  )
}
