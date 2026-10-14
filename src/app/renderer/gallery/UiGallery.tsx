import React, { useEffect, useRef, useState } from 'react'
import { Plus, Settings, Trash2 } from 'lucide-react'
import { Button, type ButtonSize, type ButtonVariant } from '../components/ui/Button'
import { Dialog } from '../components/ui/Dialog'
import {
  IconButton,
  type IconButtonSize,
  type IconButtonVariant,
} from '../components/ui/IconButton'
import { Popover } from '../components/ui/Popover'
import { SettingRow } from '../components/ui/SettingRow'
import { Toggle } from '../components/ui/Toggle'
import { Tooltip } from '../components/ui/Tooltip'
import { useApplyUiTheme } from '../shell/hooks/useApplyUiTheme'
import { DEFAULT_UI_THEME, type UiTheme } from '@contexts/settings/domain/uiSettings'
import './ui-gallery.css'

declare global {
  interface Window {
    __opencoveUiGalleryTestApi?: { setTheme: (theme: UiTheme) => void }
  }
}

const BUTTON_VARIANTS: ButtonVariant[] = ['primary', 'secondary', 'ghost', 'danger']
const BUTTON_SIZES: ButtonSize[] = ['sm', 'md']
const ICON_VARIANTS: IconButtonVariant[] = ['ghost', 'secondary', 'danger']
const ICON_SIZES: IconButtonSize[] = ['xs', 'sm', 'md']

function Section({
  id,
  title,
  children,
}: {
  id: string
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="ui-gallery__section" aria-labelledby={`ui-gallery-${id}`}>
      <h2 id={`ui-gallery-${id}`} className="ui-gallery__heading">
        {title}
      </h2>
      {children}
    </section>
  )
}

/**
 * Test-only catalogue of every shared component state. E2E probes text contrast and target size
 * here in each built-in theme, so a component that regresses fails before any screen uses it.
 */
export default function UiGallery(): React.JSX.Element {
  const [theme, setTheme] = useState<UiTheme>(DEFAULT_UI_THEME)
  const [toggles, setToggles] = useState({ first: false, second: true })
  const [dialogOpen, setDialogOpen] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)
  const dialogTrigger = useRef<HTMLButtonElement | null>(null)
  const popoverTrigger = useRef<HTMLButtonElement | null>(null)
  useApplyUiTheme(theme)

  useEffect(() => {
    window.__opencoveUiGalleryTestApi = { setTheme }
    return () => {
      delete window.__opencoveUiGalleryTestApi
    }
  }, [])

  return (
    <main className="ui-gallery" data-testid="ui-gallery">
      <Section id="button" title="Button">
        {BUTTON_SIZES.map(size => (
          <div className="ui-gallery__row" key={size}>
            {BUTTON_VARIANTS.map(variant => (
              <Button key={variant} variant={variant} size={size}>
                {variant === 'danger' ? 'Delete' : variant === 'primary' ? 'Save' : 'Cancel'}
              </Button>
            ))}
            <Button size={size} disabled>
              Unavailable
            </Button>
            <Button size={size} variant="primary" loading>
              Saving
            </Button>
          </div>
        ))}
      </Section>

      <Section id="icon-button" title="IconButton">
        {ICON_SIZES.map(size => (
          <div className="ui-gallery__row" key={size}>
            {ICON_VARIANTS.map(variant => (
              <IconButton key={variant} variant={variant} size={size} label={`${variant} ${size}`}>
                {variant === 'danger' ? <Trash2 aria-hidden="true" /> : <Plus aria-hidden="true" />}
              </IconButton>
            ))}
            <IconButton size={size} label={`disabled ${size}`} disabled>
              <Settings aria-hidden="true" />
            </IconButton>
          </div>
        ))}
      </Section>

      <Section id="toggle" title="Toggle and SettingRow">
        <div className="ui-gallery__rows">
          <SettingRow
            label="Show the minimap"
            description="Keeps an overview of the canvas in the corner."
            control={
              <Toggle
                label="Show the minimap"
                checked={toggles.first}
                onCheckedChange={first => setToggles(current => ({ ...current, first }))}
              />
            }
          />
          <SettingRow
            label="Agent working effect"
            control={
              <Toggle
                label="Agent working effect"
                checked={toggles.second}
                onCheckedChange={second => setToggles(current => ({ ...current, second }))}
              />
            }
          />
          <SettingRow
            label="Managed by your organization"
            description="This preference cannot be changed here."
            control={
              <Toggle label="Managed preference" checked disabled onCheckedChange={() => {}} />
            }
          />
        </div>
      </Section>

      <Section id="tooltip" title="Tooltip">
        <div className="ui-gallery__row">
          <Tooltip content="Arrange windows by kind, then by last activity">
            <Button data-testid="ui-gallery-tooltip-trigger">Arrange</Button>
          </Tooltip>
          <IconButton label="Open settings" title="Open settings (⌘,)">
            <Settings aria-hidden="true" />
          </IconButton>
        </div>
      </Section>

      <Section id="layers" title="Dialog and Popover">
        <div className="ui-gallery__row">
          <Button
            ref={dialogTrigger}
            data-testid="ui-gallery-open-dialog"
            onClick={() => setDialogOpen(true)}
          >
            Open dialog
          </Button>
          <Button
            ref={popoverTrigger}
            data-testid="ui-gallery-open-popover"
            onClick={() => setPopoverOpen(open => !open)}
          >
            Open popover
          </Button>
        </div>
      </Section>

      <Dialog
        open={dialogOpen}
        onDismiss={() => setDialogOpen(false)}
        returnFocus={dialogTrigger}
        aria-labelledby="ui-gallery-dialog-title"
        className="cove-window ui-gallery__dialog"
        backdropClassName="cove-window-backdrop"
        data-testid="ui-gallery-dialog"
      >
        <h2 id="ui-gallery-dialog-title" className="ui-gallery__heading">
          Delete this Space?
        </h2>
        <p className="ui-gallery__text">Its windows move to the canvas. Terminals keep running.</p>
        <div className="ui-gallery__row ui-gallery__row--end">
          <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => setDialogOpen(false)}>
            Delete Space
          </Button>
        </div>
      </Dialog>

      <Popover
        open={popoverOpen}
        anchorRef={popoverTrigger}
        onDismiss={() => setPopoverOpen(false)}
        className="ui-gallery__popover"
        data-testid="ui-gallery-popover"
      >
        <p className="ui-gallery__text">Popover content follows the theme.</p>
        <Button size="sm" onClick={() => setPopoverOpen(false)}>
          Done
        </Button>
      </Popover>
    </main>
  )
}
