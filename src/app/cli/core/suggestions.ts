/** Suggestions are diagnostics only; never use them to resolve a target. */
export function editDistance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + Number(a[i - 1] !== b[j - 1]))
      prev = old
    }
  }
  return row[b.length]
}
export function closeNames(value: string, names: string[]): string[] {
  return [...new Set(names)]
    .map(name => ({ name, distance: editDistance(value.toLowerCase(), name.toLowerCase()) }))
    .filter(item => item.distance <= 2)
    .sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name))
    .slice(0, 3)
    .map(item => item.name)
}
