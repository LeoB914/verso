/** Sort BibTeX entries by key and drop exact duplicate keys (keep the last). */
export function cleanBib(content: string): string {
  const blocks = content
    .split(/(?=@[a-zA-Z]+\s*[{(])/)
    .map((block) => block.trim())
    .filter((block) => block.startsWith('@'))
  const byKey = new Map<string, string>()
  const prefix: string[] = []
  for (const block of blocks) {
    const key = /@[a-zA-Z]+\s*[{(]\s*([^,\s]+)/.exec(block)?.[1]
    if (!key) {
      prefix.push(block)
      continue
    }
    byKey.set(key.toLowerCase(), block)
  }
  const sorted = [...byKey.values()].sort((a, b) => a.localeCompare(b))
  return [...prefix, ...sorted].join('\n\n').trim() + '\n'
}
