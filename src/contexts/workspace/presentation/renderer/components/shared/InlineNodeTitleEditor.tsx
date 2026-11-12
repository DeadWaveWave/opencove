import { useCallback, useEffect, useRef, useState } from 'react'
import type { JSX, MouseEvent, PointerEvent } from 'react'

/** A press on a title that moves its window, held this long, is a grab: let go, it renames nothing. */
const TITLE_HOLD_MS = 400
/** How far, in px, a press may travel before it is a drag rather than a click. */
const TITLE_CLICK_SLOP = 4

interface TitlePress {
  x: number
  y: number
  grabbed: boolean
  /** Ends the press wherever the pointer is let go: the window may have been dragged off it. */
  release: () => void
}

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

/**
 * A window's title, renamed in place. It is its window's drag surface too: a click renames, a
 * press held or dragged moves the window (the canvas drags it; the title only keeps that press
 * from renaming). The window lets the title's clicks through (`isWindowTitleGesture`).
 */
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
  const pressRef = useRef<TitlePress | null>(null)
  const [isHeld, setIsHeld] = useState(false)
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

  useEffect(() => {
    return () => {
      pressRef.current?.release()
    }
  }, [])

  const stopPointerEvent = (event: PointerEvent<HTMLElement>): void => {
    event.stopPropagation()
  }

  // Only watches the press: it lets the event on to the canvas, which drags the window from here.
  const beginPress = (event: PointerEvent<HTMLElement>): void => {
    pressRef.current?.release()
    pressRef.current = null
    if (event.button !== 0) {
      return
    }

    const press: TitlePress = {
      x: event.clientX,
      y: event.clientY,
      grabbed: false,
      release: () => {
        window.clearTimeout(holdTimer)
        window.removeEventListener('pointerup', press.release, true)
        window.removeEventListener('pointercancel', press.release, true)
        setIsHeld(false)
      },
    }
    const holdTimer = window.setTimeout(() => {
      press.grabbed = true
      setIsHeld(true)
    }, TITLE_HOLD_MS)
    window.addEventListener('pointerup', press.release, true)
    window.addEventListener('pointercancel', press.release, true)
    pressRef.current = press
  }

  const trackPress = (event: PointerEvent<HTMLElement>): void => {
    const press = pressRef.current
    if (!press || press.grabbed) {
      return
    }

    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > TITLE_CLICK_SLOP) {
      press.grabbed = true
    }
  }

  const handleDisplayClick = (event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
    const press = pressRef.current
    pressRef.current = null
    if (press?.grabbed) {
      return
    }

    beginEditing()
  }

  const stopMouseEvent = (event: MouseEvent<HTMLElement>): void => {
    event.stopPropagation()
  }

  const rootClassName = [
    'node-title-editor',
    `${classNamePrefix}__title`,
    isEditing ? 'node-title-editor--editing' : 'node-title-editor--display',
  ]
    .filter(Boolean)
    .join(' ')
  const displayClassName = [
    'node-title-editor__display',
    `${classNamePrefix}__title-display`,
    'nowheel',
    normalizedValue.length === 0
      ? `node-title-editor__display--placeholder ${classNamePrefix}__title-display--placeholder`
      : '',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span data-cove-part="window-title" className={rootClassName} data-testid={rootTestId}>
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
          data-cove-title-gesture="move"
          data-cove-title-held={isHeld ? 'true' : undefined}
          title={`${prefix ?? ''}${displayText}`}
          onPointerDown={beginPress}
          onPointerMove={trackPress}
          onClick={handleDisplayClick}
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
