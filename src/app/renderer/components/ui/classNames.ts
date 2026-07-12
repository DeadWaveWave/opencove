import { clsx, type ClassValue } from 'clsx'

export function classNames(...values: ClassValue[]): string {
  return clsx(values)
}
