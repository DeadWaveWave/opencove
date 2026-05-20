import React from 'react'

export function SettingsPanelNavButton({
  isActive,
  isCurrent = isActive,
  label,
  testId,
  tone = 'default',
  onClick,
}: {
  isActive: boolean
  isCurrent?: boolean
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
      {label}
    </button>
  )
}
