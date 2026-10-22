/**
 * Small HTML → LaTeX converter for rich-text paste (Word, Pages, browsers).
 * Regex based and deliberately conservative; unknown tags are dropped and
 * their text kept. The result is plain LaTeX source, never executable HTML.
 */

const BLOCK_TAGS = ['p', 'div', 'section', 'article', 'header', 'footer']

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '\\&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
}

function escapeLatex(text: string): string {
  return decodeEntities(text)
    .replace(/([#$%&_{}])/g, '\\$1')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}')
    .replace(/∞/g, '$\\infty$')
}

function inline(html: string): string {
  let text = html
  const open = '\uE000'
  const arg = '\uE001'
  const close = '\uE002'
  text = text.replace(
    /<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _tag, inner) => `${open}textbf${arg}${inner}${close}`
  )
  text = text.replace(
    /<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi,
    (_m, _tag, inner) => `${open}textit${arg}${inner}${close}`
  )
  text = text.replace(
    /<u\b[^>]*>([\s\S]*?)<\/u>/gi,
    (_m, inner) => `${open}underline${arg}${inner}${close}`
  )
  text = text.replace(
    /<code\b[^>]*>([\s\S]*?)<\/code>/gi,
    (_m, inner) => `${open}texttt${arg}${inner}${close}`
  )
  text = text.replace(
    /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi,
    (_m, href, inner) => `${open}href${arg}${href}${close}${arg}${inner}${close}`
  )
  text = text.replace(/<br\s*\/?>/gi, '\\\\\n')
  text = text.replace(/<[^>]+>/g, '')
  text = escapeLatex(text)
  text = text
    .replace(/\uE000/g, '\\')
    .replace(/\uE001/g, '{')
    .replace(/\uE002/g, '}')
  return text.replace(/\s+/g, ' ').trim()
}

function lists(html: string): string {
  return html.replace(/<(ul|ol)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_m, tag: string, inner: string) => {
    const items = [...inner.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/gi)].map(
      (match) => `  \\item ${inline(match[1])}`
    )
    const env = tag.toLowerCase() === 'ol' ? 'enumerate' : 'itemize'
    return `\n\\begin{${env}}\n${items.join('\n')}\n\\end{${env}}\n`
  })
}

export function htmlToLatex(html: string): string {
  let text = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')

  text = text.replace(
    /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi,
    (_m, inner) => `\n\\section{${inline(inner)}}\n`
  )
  text = text.replace(
    /<h2\b[^>]*>([\s\S]*?)<\/h2>/gi,
    (_m, inner) => `\n\\subsection{${inline(inner)}}\n`
  )
  text = text.replace(
    /<h3\b[^>]*>([\s\S]*?)<\/h3>/gi,
    (_m, inner) => `\n\\subsubsection{${inline(inner)}}\n`
  )
  text = text.replace(
    /<h[4-6]\b[^>]*>([\s\S]*?)<\/h[4-6]>/gi,
    (_m, inner) => `\n\\paragraph{${inline(inner)}}\n`
  )
  text = lists(text)
  for (const tag of BLOCK_TAGS) {
    text = text.replace(
      new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi'),
      (_m, inner) => `\n${inline(inner)}\n`
    )
  }
  text = text.replace(/<li\b[^>]*>([\s\S]*?)<\/li>/gi, (_m, inner) => `\\item ${inline(inner)}\n`)
  text = text.replace(/<[^>]+>/g, '')
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
