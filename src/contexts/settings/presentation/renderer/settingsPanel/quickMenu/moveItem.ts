export function moveItem<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) {
    return items
  }

  if (fromIndex < 0 || fromIndex >= items.length) {
    return items
  }

  if (toIndex < 0 || toIndex >= items.length) {
    return items
  }

  const next = [...items]
  const [moved] = next.splice(fromIndex, 1)
  if (!moved) {
    return items
  }

  next.splice(toIndex, 0, moved)
  return next
}
