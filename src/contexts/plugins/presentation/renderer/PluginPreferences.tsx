import { Toggle } from '@app/renderer/components/ui/Toggle'
import { CoveSelect } from '@app/renderer/components/CoveSelect'
import { isPluginPreferenceValue } from '../../domain/pluginHostExtensionValidation'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from '@app/renderer/i18n'
import type { PluginManifest, PluginPreferenceValue } from '../../domain/pluginTypes'
import type { PluginPreferences as Values } from '../../application/pluginPreferences'
import { pluginErrorMessage } from './pluginErrorMessage'
import './plugin-preferences.css'

export function PluginPreferences({ plugin }: { plugin: PluginManifest }) {
  const { t } = useTranslation()
  const [values, setValues] = useState<Values | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  useEffect(() => {
    const request = ++generation.current
    let current = true
    setError(null)
    setBusy(false)
    setValues(null)
    if (!plugin.preferences?.length) {
      return
    }
    void window.opencoveApi.controlSurface
      .invoke<Values>({
        kind: 'query',
        id: 'plugin.preferences.get',
        payload: { pluginId: plugin.id },
      })
      .then(result => {
        if (current) {
          setValues(result)
        }
      })
      .catch(cause => {
        if (current) {
          setError(pluginErrorMessage(cause))
        }
      })
    return () => {
      current = false
      if (generation.current === request) {
        generation.current += 1
      }
    }
  }, [plugin.id, plugin.revision, plugin.preferences?.length])
  if (!plugin.preferences?.length) {
    return null
  }
  const save = async (key: string, value: PluginPreferenceValue) => {
    const request = generation.current
    const previous = values
    setValues(current => (current ? { ...current, [key]: value } : current))
    setBusy(true)
    setError(null)
    try {
      const result = await window.opencoveApi.controlSurface.invoke<Values>({
        kind: 'command',
        id: 'plugin.preferences.set',
        payload: { pluginId: plugin.id, key, value },
      })
      if (generation.current === request) {
        setValues(result)
      }
    } catch (cause) {
      if (generation.current === request) {
        setValues(previous)
        setError(pluginErrorMessage(cause))
      }
    } finally {
      if (generation.current === request) {
        setBusy(false)
      }
    }
  }
  return (
    <section className="plugin-preferences" aria-label={t('pluginHostExtensions.preferences')}>
      <h4>{t('pluginHostExtensions.preferences')}</h4>
      {error ? (
        <p role="alert" className="cove-window__error">
          {error}
        </p>
      ) : null}
      {!values ? (
        error ? null : (
          <p>{t('common.loading')}</p>
        )
      ) : (
        plugin.preferences.map(field => {
          const id = `plugin-preference-${plugin.id}-${field.id}`
          const value = values[field.id]
          return (
            <div className="plugin-preferences__field" key={field.id}>
              <label htmlFor={id}>{field.title}</label>
              {field.description ? <p id={`${id}-help`}>{field.description}</p> : null}
              {field.enum ? (
                <CoveSelect
                  id={id}
                  testId={id}
                  value={String(value)}
                  disabled={busy}
                  ariaLabel={field.title}
                  options={field.enum.map(item => ({ value: String(item), label: String(item) }))}
                  onChange={selected => {
                    const next = field.enum!.find(item => String(item) === selected)
                    if (next !== undefined) {
                      void save(field.id, next)
                    }
                  }}
                />
              ) : field.type === 'boolean' ? (
                <Toggle
                  id={id}
                  data-testid={id}
                  label={field.title}
                  checked={value === true}
                  disabled={busy}
                  describedBy={field.description ? `${id}-help` : undefined}
                  onCheckedChange={checked => {
                    void save(field.id, checked)
                  }}
                />
              ) : (
                <input
                  id={id}
                  data-testid={id}
                  key={`${field.id}:${String(value)}`}
                  type={field.type === 'number' ? 'number' : 'text'}
                  defaultValue={String(value)}
                  min={field.minimum}
                  max={field.maximum}
                  maxLength={4000}
                  disabled={busy}
                  aria-describedby={field.description ? `${id}-help` : undefined}
                  onBlur={event => {
                    const next =
                      field.type === 'number' ? Number(event.target.value) : event.target.value
                    if (
                      (field.type === 'number' && !event.target.value.trim()) ||
                      !isPluginPreferenceValue(field, next)
                    ) {
                      event.target.value = String(value)
                      setError(t('pluginHostExtensions.invalidPreference'))
                      return
                    }
                    if (next !== value) {
                      void save(field.id, next)
                    }
                  }}
                  onKeyDown={event => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur()
                    }
                  }}
                />
              )}
            </div>
          )
        })
      )}
    </section>
  )
}
