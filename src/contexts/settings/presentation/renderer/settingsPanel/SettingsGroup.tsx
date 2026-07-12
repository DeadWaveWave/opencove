import type { ReactNode } from 'react'

function joinClassName(baseClassName: string, className?: string): string {
  return className ? `${baseClassName} ${className}` : baseClassName
}

export function SettingsGroup({
  id,
  title,
  description,
  className,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  className?: string
  children: ReactNode
}): React.JSX.Element {
  const titleId = `${id}-title`
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <section
      className={joinClassName('settings-panel__group', className)}
      id={id}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <header className="settings-panel__group-header">
        <h3 className="settings-panel__group-title" id={titleId}>
          {title}
        </h3>
        {description ? (
          <p className="settings-panel__group-description" id={descriptionId}>
            {description}
          </p>
        ) : null}
      </header>
      {children}
    </section>
  )
}

export function SettingsGroupBody({
  id,
  className,
  children,
}: {
  id?: string
  className?: string
  children: ReactNode
}): React.JSX.Element {
  return (
    <div id={id} className={joinClassName('settings-panel__group-body', className)}>
      {children}
    </div>
  )
}

export function SettingsModule({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const titleId = `${id}-title`
  const descriptionId = description ? `${id}-description` : undefined

  return (
    <section
      className="settings-panel__module"
      id={id}
      role="group"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
    >
      <header className="settings-panel__module-header">
        <h4 className="settings-panel__module-title" id={titleId}>
          {title}
        </h4>
        {description ? (
          <p className="settings-panel__module-description" id={descriptionId}>
            {description}
          </p>
        ) : null}
      </header>
      <div className="settings-panel__module-content">{children}</div>
    </section>
  )
}
