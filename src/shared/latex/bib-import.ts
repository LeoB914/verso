/**
 * Pure helpers for "Add entry by identifier" (DOI / arXiv / ISBN): decide
 * which service to ask and turn an arXiv Atom response into BibTeX.
 */

export type BibIdentifier =
  { kind: 'arxiv'; id: string } | { kind: 'isbn'; isbn: string } | { kind: 'doi'; doi: string }

/**
 * Classify user input. Only input that *is* an arXiv id (optionally with an
 * `arXiv:` prefix or an arxiv.org URL) counts as arXiv — DOIs often contain
 * `2020.12345`-like segments and must still go to doi.org.
 */
export function classifyBibIdentifier(raw: string): BibIdentifier | null {
  const input = raw.trim()
  if (!input) return null

  const arxiv =
    /^(?:arxiv:\s*)?(\d{4}\.\d{4,5})(?:v\d+)?$/i.exec(input) ??
    /^(?:https?:\/\/)?(?:www\.)?arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?\/?$/i.exec(
      input
    )
  if (arxiv) return { kind: 'arxiv', id: arxiv[1] }

  const isbn = input.replace(/[-\s]/g, '').toUpperCase()
  if (/^(?:\d{9}[\dX]|97[89]\d{10})$/.test(isbn)) return { kind: 'isbn', isbn }

  const doi = input.replace(/^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)/i, '')
  return { kind: 'doi', doi }
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Build a BibTeX entry from an arXiv API (Atom) response. Fields are read from
 * the `<entry>` element — the feed itself also has a `<title>` ("arXiv Query:
 * …") that must not end up as the paper title. Returns null when the response
 * contains no entry.
 */
export function arxivAtomToBibtex(xml: string, id: string): { bibtex: string; key: string } | null {
  const entry = /<entry\b[^>]*>([\s\S]*?)<\/entry>/i.exec(xml)?.[1]
  if (!entry) return null
  const title = decodeXml(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(entry)?.[1] ?? '')
  if (!title) return null
  const authors = [...entry.matchAll(/<author\b[^>]*>[\s\S]*?<name>([\s\S]*?)<\/name>/gi)].map(
    (match) => decodeXml(match[1])
  )
  const year = /<published>(\d{4})/i.exec(entry)?.[1] ?? ''
  const key = `arXiv${id.replace('.', '')}`
  const bibtex = [
    `@article{${key},`,
    `  author = {${authors.join(' and ')}},`,
    `  title = {${title}},`,
    `  year = {${year}},`,
    `  eprint = {${id}},`,
    '  archivePrefix = {arXiv},',
    '}',
  ].join('\n')
  return { bibtex, key }
}
