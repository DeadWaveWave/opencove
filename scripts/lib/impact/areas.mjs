// Areas are computed, never configured: `src/contexts/<x>`, `src/app/<x>`, `src/shared`,
// `src/platform`, otherwise the top-level folder.
export function areaOf(path) {
  const parts = path.split('/')
  if (parts[0] === 'src') {
    if ((parts[1] === 'contexts' || parts[1] === 'app') && parts.length > 3) {
      return `${parts[1]}/${parts[2]}`
    }
    return parts.length > 2 ? parts[1] : 'src'
  }
  return parts.length > 1 ? parts[0] : '.'
}
