/** Local (fast) word estimate for the open file — used until texcount runs. */
export function wordCount(text: string): number {
  const stripped = text
    .replace(/%[^\n]*/g, ' ')
    .replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?(\{[^{}]*\})?/g, ' ')
  const matches = stripped.match(/[^\s{}\\]+/g)
  return matches ? matches.length : 0
}
