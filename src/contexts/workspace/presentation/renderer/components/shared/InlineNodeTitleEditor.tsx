import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent, PointerEvent } from 'react'

export interface InlineNodeTitleEditorProps {
  value: string
  placeholder: string
  ariaLabel: string
  classNamePrefix: string
  rootTestId?: string
  displayTestId: string
  inputTestId: string
  prefix?: string | null
  spellCheck?: boolean
  onCommit: (value: string) => void
}

export function InlineNodeTitleEditor({
  value,
  placeholder,
  ariaLabel,
  classNamePrefix,
  rootTestId,
  displayTestId,
  inputTestId,
  prefix = null,
  spellCheck = false,
  onCommit,
}: InlineNodeTitleEditorProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const cancelRef = useRef(false)
  const normalizedValue = value.trim()
  const [isEditing, setIsEditing] = useState(false)
  const [draft, setDraft] = useState(normalizedValue)
  const displayText = normalizedValue.length > 0 ? normalizedValue : placeholder

  useEffect(() => {
    if (isEditing) {
      return
    }

    setDraft(normalizedValue)
  }, [isEditing, normalizedValue])

  useEffect(() => {
    if (!isEditing) {
      return
    }

    const input = inputRef.current
    if (!input) {
      return
    }

    input.focus()
    const caretPosition = input.value.length
    input.setSelectionRange(caretPosition, caretPosition)
  }, [isEditing])

  const beginEditing = useCallback(() => {
    cancelRef.current = false
    setDraft(normalizedValue)
    setIsEditing(true)
  }, [normalizedValue])

  const commitEdit = useCallback(() => {
    const nextValue = draft.trim()
    setDraft(nextValue)
    setIsEditing(false)

    if (nextValue !== normalizedValue) {
      onCommit(nextValue)
    }
  }, [draft, normalizedValue, onCommit])

  const cancelEdit = useCallback(() => {
    cancelRef.current = true
    setDraft(normalizedValue)
    setIsEditing(false)
  }, [normalizedValue])

  const handleBlur = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current = false
      setDraft(normalizedValue)
      setIsEditing(false)
      return
    }

    commitEdit()
  }, [commitEdit, normalizedValue])

  const stopPointerEvent = (event: PointerEvent<HTMLElement>): void => {
    event.stopPropagation()
  }

  const stopMouseEvent = (event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
  }

  const rootClassName = [
    'node-title-editor',
    `${classNamePrefix}__title`,
    isEditing ? 'node-title-editor--editing' : 'node-title-editor--display',
  ].join(' ')
  const displayClassName = [
    'node-title-editor__display',
    `${classNamePrefix}__title-display`,
    'nowheel',
    'nodrag',
    normalizedValue.length === 0
      ? `node-title-editor__display--placeholder ${classNamePrefix}__title-display--placeholder`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span className={rootClassName} data-testid={rootTestId}>
      {isEditing ? (
        <span className={`node-title-editor__editable ${classNamePrefix}__title-editable`}>
          {prefix ? (
            <span className={`node-title-editor__prefix ${classNamePrefix}__title-prefix`}>
              {prefix}
            </span>
          ) : null}
          <span className="node-title-editor__input-wrap">
            <input
              ref={inputRef}
              className={`node-title-editor__input ${classNamePrefix}__title-input nowheel nodrag`}
              data-testid={inputTestId}
              value={draft}
              placeholder={placeholder}
              aria-label={ariaLabel}
              title={`${prefix ?? ''}${draft.trim().length > 0 ? draft : placeholder}`}
              spellCheck={spellCheck}
              onFocus={beginEditing}
              onPointerDownCapture={stopPointerEvent}
              onPointerDown={stopPointerEvent}
              onClick={stopMouseEvent}
              onChange={event => {
                setDraft(event.target.value)
              }}
              onBlur={handleBlur}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing) {
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  cancelEdit()
                  event.currentTarget.blur()
                  return
                }

                if (event.key === 'Enter') {
                  event.preventDefault()
                  event.currentTarget.blur()
                }
              }}
            />
          </span>
        </span>
      ) : (
        <span
          className={displayClassName}
          data-testid={displayTestId}
          title={`${prefix ?? ''}${displayText}`}
          onPointerDownCapture={stopPointerEvent}
          onPointerDown={stopPointerEvent}
          onClick={event => {
            event.stopPropagation()
            beginEditing()
          }}
        >
          {prefix ? (
            <span className={`node-title-editor__prefix ${classNamePrefix}__title-prefix`}>
              {prefix}
            </span>
          ) : null}
          <span className="node-title-editor__display-text">{displayText}</span>
        </span>
      )}
    </span>
  )
}
