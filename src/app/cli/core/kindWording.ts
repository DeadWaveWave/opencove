/** English articles for the CLI's node and selector kind names. */
export function kindWithArticle(kind: string): string {
  return `${/^[aeiou]/i.test(kind) ? 'an' : 'a'} ${kind}`
}
