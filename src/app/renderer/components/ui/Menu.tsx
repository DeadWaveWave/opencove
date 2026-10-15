import React from 'react'
import { Check, ChevronRight, LoaderCircle } from 'lucide-react'
import { classNames } from './classNames'

const MenuRoleContext = React.createContext(false)

/**
 * Marks content owned by a `role="menu"` container. Items inside take menu roles; elsewhere they
 * stay plain buttons, so a menu only declares the role once every one of its rows is a menu item.
 */
export function MenuRoleScope({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <MenuRoleContext.Provider value={true}>{children}</MenuRoleContext.Provider>
}

export interface MenuItemShortcut {
  /** What the row shows, e.g. ⌘T or Ctrl T. */
  label: string
  /** The same chord for assistive technology, e.g. Meta+T. */
  ariaKeyShortcuts: string
}

interface MenuRowProps extends Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  'type' | 'role'
> {
  icon?: React.ReactNode
  shortcut?: MenuItemShortcut | null
  tone?: 'default' | 'danger'
}

export interface MenuItemProps extends MenuRowProps {
  /** The row opens a submenu: it announces the popup and shows a chevron, or a spinner while loading. */
  submenu?: { open: boolean; loading?: boolean }
}

export interface MenuCheckboxItemProps extends MenuRowProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}

/** Icon, label and shortcut columns. A row without a label is an icon-only submenu toggle. */
function MenuRowContent({
  icon,
  label,
  shortcut,
  trailing,
}: {
  icon: React.ReactNode
  label: React.ReactNode
  shortcut: MenuItemShortcut | null | undefined
  trailing: React.ReactNode
}): React.JSX.Element {
  const hasLabel = label !== undefined && label !== null && label !== false
  return (
    <>
      {hasLabel ? (
        <>
          <span className="cove-menu-item__icon" aria-hidden="true">
            {icon}
          </span>
          <span className="cove-menu-item__label">{label}</span>
        </>
      ) : null}
      {shortcut ? (
        <kbd className="cove-menu-item__shortcut" aria-hidden="true">
          {shortcut.label}
        </kbd>
      ) : null}
      {trailing ? (
        <span className="cove-menu-item__trailing" aria-hidden="true">
          {trailing}
        </span>
      ) : null}
    </>
  )
}

export const MenuItem = React.forwardRef<HTMLButtonElement, MenuItemProps>(function MenuItem(
  { icon, shortcut, tone = 'default', submenu, className, children, ...buttonProps },
  forwardedRef,
) {
  const inMenu = React.useContext(MenuRoleContext)
  let trailing: React.ReactNode = null
  if (submenu?.loading) {
    trailing = <LoaderCircle className="cove-menu-item__spinner" />
  } else if (submenu) {
    trailing = <ChevronRight className="cove-menu-item__chevron" />
  }

  return (
    <button
      {...buttonProps}
      ref={forwardedRef}
      type="button"
      role={inMenu ? 'menuitem' : undefined}
      data-cove-part="menu-item"
      data-tone={tone === 'danger' ? 'danger' : undefined}
      aria-haspopup={submenu ? 'menu' : undefined}
      aria-expanded={submenu ? submenu.open : undefined}
      aria-busy={submenu?.loading ? true : undefined}
      aria-keyshortcuts={shortcut?.ariaKeyShortcuts}
      className={classNames('cove-menu-item', className)}
    >
      <MenuRowContent icon={icon} label={children} shortcut={shortcut} trailing={trailing} />
    </button>
  )
})

export const MenuCheckboxItem = React.forwardRef<HTMLButtonElement, MenuCheckboxItemProps>(
  function MenuCheckboxItem(
    {
      checked,
      onCheckedChange,
      icon,
      shortcut,
      tone = 'default',
      className,
      children,
      onClick,
      ...buttonProps
    },
    forwardedRef,
  ) {
    const inMenu = React.useContext(MenuRoleContext)
    return (
      <button
        {...buttonProps}
        ref={forwardedRef}
        type="button"
        role={inMenu ? 'menuitemcheckbox' : undefined}
        aria-checked={inMenu ? checked : undefined}
        aria-pressed={inMenu ? undefined : checked}
        data-cove-part="menu-item"
        data-state={checked ? 'checked' : 'unchecked'}
        data-tone={tone === 'danger' ? 'danger' : undefined}
        aria-keyshortcuts={shortcut?.ariaKeyShortcuts}
        className={classNames('cove-menu-item', className)}
        onClick={event => {
          onClick?.(event)
          if (!event.defaultPrevented) {
            onCheckedChange(!checked)
          }
        }}
      >
        <MenuRowContent
          icon={icon}
          label={children}
          shortcut={shortcut}
          trailing={<Check className="cove-menu-item__check" />}
        />
      </button>
    )
  },
)

export function MenuSeparator({ className }: { className?: string }): React.JSX.Element {
  return <div role="separator" className={classNames('cove-menu-separator', className)} />
}
