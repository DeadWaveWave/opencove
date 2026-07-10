import React from 'react'

export function SettingsPanelNavButton({
  isActive,
  isCurrent = isActive,
  icon,
  label,
  testId,
  tone = 'default',
  onClick,
}: {
  isActive: boolean
  isCurrent?: boolean
  icon?: React.ReactNode
  label: string
  testId?: string
  tone?: 'default' | 'secondary'
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      data-testid={testId}
      data-settings-nav-tone={tone}
      aria-current={isActive && isCurrent ? 'page' : undefined}
      onClick={onClick}
      className={`settings-panel__nav-button${tone === 'secondary' ? ' settings-panel__nav-button--secondary' : ''}${isActive ? ' settings-panel__nav-button--active' : ''}${isActive && !isCurrent ? ' settings-panel__nav-button--parent-active' : ''}`}
    >
      {icon ? <span className="settings-panel__nav-button-icon">{icon}</span> : null}
      <span className="settings-panel__nav-button-label">{label}</span>
    </button>
  )
}
