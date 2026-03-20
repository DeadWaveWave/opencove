import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'

export interface CoveSelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface MenuPosition {
  top: number
  left: number
  width: number
  maxHeight: number
}

export function CoveSelect({
  id,
  value,
  options,
  disabled = false,
  className,
  triggerClassName,
  menuClassName,
  size = 'default',
  testId,
  triggerTestId,
  menuTestId,
  ariaLabel,
  onChange,
}: {
  id?: string
  value: string
  options: CoveSelectOption[]
  disabled?: boolean
  className?: string
  triggerClassName?: string
  menuClassName?: string
  size?: 'default' | 'compact'
  testId?: string
  triggerTestId?: string
  menuTestId?: string
  ariaLabel?: string
  onChange: (nextValue: string) => void
}): React.JSX.Element {
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [isOpen, setIsOpen] = useState(false)
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null)

  const selectedIndex = useMemo(
    () => options.findIndex(option => option.value === value),
    [options, value],
  )
  const selectedOption = selectedIndex >= 0 ? options[selectedIndex] : null

  const resolveEnabledIndex = useCallback(
    (startIndex: number, direction: 1 | -1): number => {
      if (options.length === 0) {
        return -1
      }

      let currentIndex = startIndex
      for (let steps = 0; steps < options.length; steps += 1) {
        currentIndex = (currentIndex + direction + options.length) % options.length
        if (!options[currentIndex]?.disabled) {
          return currentIndex
        }
      }

      return -1
    },
    [options],
  )

  const resolveInitialIndex = useCallback((): number => {
    if (selectedIndex >= 0 && !options[selectedIndex]?.disabled) {
      return selectedIndex
    }

    return resolveEnabledIndex(-1, 1)
  }, [options, resolveEnabledIndex, selectedIndex])

  const closeMenu = useCallback((): void => {
    setIsOpen(false)
    setMenuPosition(null)
  }, [])

  const updateMenuPosition = useCallback((): void => {
    const trigger = triggerRef.current
    if (!trigger) {
      return
    }

    const rect = trigger.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth
    const preferredHeight = Math.min(Math.max(options.length, 1) * 40 + 12, 280)
    const availableBelow = viewportHeight - rect.bottom - 8
    const availableAbove = rect.top - 8
    const shouldOpenAbove =
      availableBelow < Math.min(preferredHeight, 180) && availableAbove > availableBelow
    const maxHeight = Math.max(120, shouldOpenAbove ? availableAbove : availableBelow)
    const width = Math.min(rect.width, viewportWidth - 16)
    const left = Math.min(rect.left, viewportWidth - width - 8)
    const top = shouldOpenAbove
      ? Math.max(8, rect.top - Math.min(preferredHeight, maxHeight) - 6)
      : Math.min(viewportHeight - maxHeight - 8, rect.bottom + 6)

    setMenuPosition({
      top,
      left,
      width,
      maxHeight,
    })
  }, [options.length])

  const openMenu = useCallback(
    (index = resolveInitialIndex()): void => {
      if (disabled) {
        return
      }

      setHighlightedIndex(index)
      setIsOpen(true)
    },
    [disabled, resolveInitialIndex],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    updateMenuPosition()

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node)) {
        return
      }

      if (rootRef.current?.contains(target) || menuRef.current?.contains(target)) {
        return
      }

      closeMenu()
    }

    const handleWindowChange = () => {
      updateMenuPosition()
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    window.addEventListener('resize', handleWindowChange)
    window.addEventListener('scroll', handleWindowChange, true)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown, true)
      window.removeEventListener('resize', handleWindowChange)
      window.removeEventListener('scroll', handleWindowChange, true)
    }
  }, [closeMenu, isOpen, updateMenuPosition])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const nextTarget = optionRefs.current[highlightedIndex] ?? null
    nextTarget?.focus()
  }, [highlightedIndex, isOpen])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    const currentSelectedIndex = resolveInitialIndex()
    if (currentSelectedIndex !== highlightedIndex) {
      setHighlightedIndex(currentSelectedIndex)
    }
  }, [highlightedIndex, isOpen, resolveInitialIndex])

  const selectOption = (nextValue: string): void => {
    onChange(nextValue)
    closeMenu()
    triggerRef.current?.focus()
  }

  const handleTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) {
      return
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (isOpen) {
        setHighlightedIndex(resolveEnabledIndex(highlightedIndex, 1))
        return
      }

      openMenu(resolveEnabledIndex(selectedIndex - 1, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (isOpen) {
        setHighlightedIndex(resolveEnabledIndex(highlightedIndex, -1))
        return
      }

      openMenu(resolveEnabledIndex(selectedIndex + 1, -1))
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (isOpen && highlightedIndex >= 0) {
        const highlightedOption = options[highlightedIndex]
        if (highlightedOption && !highlightedOption.disabled) {
          selectOption(highlightedOption.value)
        }
        return
      }

      openMenu()
      return
    }

    if (event.key === 'Escape' && isOpen) {
      event.preventDefault()
      closeMenu()
    }
  }

  const handleOptionKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    optionIndex: number,
  ): void => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setHighlightedIndex(resolveEnabledIndex(optionIndex, 1))
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      setHighlightedIndex(resolveEnabledIndex(optionIndex, -1))
      return
    }

    if (event.key === 'Home') {
      event.preventDefault()
      setHighlightedIndex(resolveEnabledIndex(-1, 1))
      return
    }

    if (event.key === 'End') {
      event.preventDefault()
      setHighlightedIndex(resolveEnabledIndex(0, -1))
      return
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      closeMenu()
      triggerRef.current?.focus()
      return
    }

    if (event.key === 'Tab') {
      closeMenu()
      return
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      const option = options[optionIndex]
      if (option && !option.disabled) {
        selectOption(option.value)
      }
    }
  }

  return (
    <div
      ref={rootRef}
      className={`cove-select cove-select--${size}${className ? ` ${className}` : ''}`}
    >
      {testId ? <input type="hidden" data-testid={testId} value={value} readOnly /> : null}
      <button
        id={id}
        ref={triggerRef}
        type="button"
        className={`cove-field cove-select__trigger${triggerClassName ? ` ${triggerClassName}` : ''}`}
        data-testid={triggerTestId ?? (testId ? `${testId}-trigger` : undefined)}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        disabled={disabled}
        onClick={() => {
          if (isOpen) {
            closeMenu()
            return
          }

          openMenu()
        }}
        onKeyDown={handleTriggerKeyDown}
      >
        <span className="cove-select__label">{selectedOption?.label ?? ''}</span>
        <ChevronDown
          aria-hidden="true"
          size={16}
          className={`cove-select__chevron${isOpen ? ' cove-select__chevron--open' : ''}`}
        />
      </button>

      {isOpen && menuPosition
        ? createPortal(
            <div
              id={listboxId}
              ref={menuRef}
              className={`cove-select__menu${menuClassName ? ` ${menuClassName}` : ''}`}
              data-testid={menuTestId ?? (testId ? `${testId}-menu` : undefined)}
              role="listbox"
              style={{
                top: menuPosition.top,
                left: menuPosition.left,
                width: menuPosition.width,
                maxHeight: menuPosition.maxHeight,
              }}
            >
              {options.map((option, index) => {
                const isSelected = option.value === value
                const isHighlighted = index === highlightedIndex

                return (
                  <button
                    key={option.value}
                    ref={element => {
                      optionRefs.current[index] = element
                    }}
                    type="button"
                    className={`cove-select__option${isSelected ? ' cove-select__option--selected' : ''}${isHighlighted ? ' cove-select__option--highlighted' : ''}`}
                    role="option"
                    aria-selected={isSelected}
                    data-cove-select-option-value={option.value}
                    disabled={option.disabled}
                    tabIndex={isHighlighted ? 0 : -1}
                    onClick={() => selectOption(option.value)}
                    onKeyDown={event => handleOptionKeyDown(event, index)}
                    onMouseEnter={() => {
                      if (option.disabled) {
                        return
                      }

                      setHighlightedIndex(index)
                    }}
                  >
                    {option.label}
                  </button>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}
