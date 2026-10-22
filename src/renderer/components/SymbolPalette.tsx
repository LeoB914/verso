import { useMemo, useState } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import { Search } from 'lucide-react'

/**
 * Symbol palette: categorised LaTeX symbols rendered with KaTeX, searchable,
 * recent inserts at the top. Click inserts the command.
 */

interface SymbolEntry {
  name: string
  command: string
  category: string
}

const SYMBOLS: SymbolEntry[] = [
  // Greek
  { name: 'alpha', command: '\\alpha', category: 'Greek' },
  { name: 'beta', command: '\\beta', category: 'Greek' },
  { name: 'gamma', command: '\\gamma', category: 'Greek' },
  { name: 'delta', command: '\\delta', category: 'Greek' },
  { name: 'epsilon', command: '\\epsilon', category: 'Greek' },
  { name: 'theta', command: '\\theta', category: 'Greek' },
  { name: 'lambda', command: '\\lambda', category: 'Greek' },
  { name: 'mu', command: '\\mu', category: 'Greek' },
  { name: 'pi', command: '\\pi', category: 'Greek' },
  { name: 'sigma', command: '\\sigma', category: 'Greek' },
  { name: 'phi', command: '\\phi', category: 'Greek' },
  { name: 'omega', command: '\\omega', category: 'Greek' },
  { name: 'Gamma', command: '\\Gamma', category: 'Greek' },
  { name: 'Delta', command: '\\Delta', category: 'Greek' },
  { name: 'Omega', command: '\\Omega', category: 'Greek' },
  // Operators
  { name: 'sum', command: '\\sum', category: 'Operators' },
  { name: 'prod', command: '\\prod', category: 'Operators' },
  { name: 'int', command: '\\int', category: 'Operators' },
  { name: 'iint', command: '\\iint', category: 'Operators' },
  { name: 'oint', command: '\\oint', category: 'Operators' },
  { name: 'lim', command: '\\lim', category: 'Operators' },
  { name: 'partial', command: '\\partial', category: 'Operators' },
  { name: 'nabla', command: '\\nabla', category: 'Operators' },
  { name: 'infty', command: '\\infty', category: 'Operators' },
  { name: 'cdot', command: '\\cdot', category: 'Operators' },
  { name: 'times', command: '\\times', category: 'Operators' },
  { name: 'pm', command: '\\pm', category: 'Operators' },
  { name: 'frac', command: '\\frac{a}{b}', category: 'Operators' },
  { name: 'sqrt', command: '\\sqrt{x}', category: 'Operators' },
  // Relations
  { name: 'leq', command: '\\leq', category: 'Relations' },
  { name: 'geq', command: '\\geq', category: 'Relations' },
  { name: 'neq', command: '\\neq', category: 'Relations' },
  { name: 'approx', command: '\\approx', category: 'Relations' },
  { name: 'equiv', command: '\\equiv', category: 'Relations' },
  { name: 'sim', command: '\\sim', category: 'Relations' },
  { name: 'propto', command: '\\propto', category: 'Relations' },
  { name: 'perp', command: '\\perp', category: 'Relations' },
  { name: 'parallel', command: '\\parallel', category: 'Relations' },
  // Sets & logic
  { name: 'in', command: '\\in', category: 'Sets & logic' },
  { name: 'notin', command: '\\notin', category: 'Sets & logic' },
  { name: 'subset', command: '\\subset', category: 'Sets & logic' },
  { name: 'subseteq', command: '\\subseteq', category: 'Sets & logic' },
  { name: 'cup', command: '\\cup', category: 'Sets & logic' },
  { name: 'cap', command: '\\cap', category: 'Sets & logic' },
  { name: 'emptyset', command: '\\emptyset', category: 'Sets & logic' },
  { name: 'forall', command: '\\forall', category: 'Sets & logic' },
  { name: 'exists', command: '\\exists', category: 'Sets & logic' },
  { name: 'neg', command: '\\neg', category: 'Sets & logic' },
  // Arrows
  { name: 'to (right arrow)', command: '\\to', category: 'Arrows' },
  { name: 'rightarrow', command: '\\rightarrow', category: 'Arrows' },
  { name: 'Rightarrow', command: '\\Rightarrow', category: 'Arrows' },
  { name: 'leftrightarrow', command: '\\leftrightarrow', category: 'Arrows' },
  { name: 'Leftrightarrow', command: '\\Leftrightarrow', category: 'Arrows' },
  { name: 'mapsto', command: '\\mapsto', category: 'Arrows' },
  { name: 'uparrow', command: '\\uparrow', category: 'Arrows' },
  { name: 'downarrow', command: '\\downarrow', category: 'Arrows' },
  // Accents
  { name: 'hat', command: '\\hat{x}', category: 'Accents' },
  { name: 'bar', command: '\\bar{x}', category: 'Accents' },
  { name: 'tilde', command: '\\tilde{x}', category: 'Accents' },
  { name: 'vec', command: '\\vec{x}', category: 'Accents' },
  { name: 'dot', command: '\\dot{x}', category: 'Accents' },
  { name: 'overline', command: '\\overline{x}', category: 'Accents' },
  // Delimiters & misc
  { name: 'left right parens', command: '\\left( x \\right)', category: 'Delimiters' },
  { name: 'left right brackets', command: '\\left[ x \\right]', category: 'Delimiters' },
  { name: 'left right braces', command: '\\left\\{ x \\right\\}', category: 'Delimiters' },
  { name: 'dots', command: '\\dots', category: 'Misc' },
  { name: 'ldots', command: '\\ldots', category: 'Misc' },
  { name: 'cdots', command: '\\cdots', category: 'Misc' },
  { name: 'text in math', command: '\\text{text}', category: 'Misc' },
  { name: 'quad space', command: '\\quad', category: 'Misc' },
]

export function renderKatex(latex: string, displayMode = false): string | null {
  try {
    return katex.renderToString(latex, { displayMode, throwOnError: true })
  } catch {
    return null
  }
}

export function SymbolPalette(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<SymbolEntry[]>([])

  const filtered = useMemo(() => {
    if (!query) return SYMBOLS
    const q = query.toLowerCase()
    return SYMBOLS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.command.toLowerCase().includes(q)
    )
  }, [query])

  const categories = useMemo(() => {
    const groups = new Map<string, SymbolEntry[]>()
    for (const symbol of filtered) {
      groups.set(symbol.category, [...(groups.get(symbol.category) ?? []), symbol])
    }
    return [...groups.entries()]
  }, [filtered])

  return (
    <div className="flex h-full flex-col" data-testid="symbol-palette">
      <div className="mx-2 mt-1.5 flex h-6 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2">
        <Search size={13} />
        <input
          className="w-full bg-transparent text-[13px] outline-none"
          placeholder="Search symbols…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>
      <div className="mt-1 flex-1 overflow-auto px-2 pb-2">
        {recent.length > 0 && (
          <div className="mb-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              Recent
            </p>
            <div className="flex flex-wrap gap-1">
              {recent.map((symbol) => (
                <SymbolButton
                  key={symbol.command}
                  symbol={symbol}
                  onInsert={() =>
                    setRecent((r) =>
                      [symbol, ...r.filter((s) => s.command !== symbol.command)].slice(0, 8)
                    )
                  }
                />
              ))}
            </div>
          </div>
        )}
        {categories.map(([category, symbols]) => (
          <div key={category} className="mb-2">
            <p className="px-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--text-tertiary)]">
              {category}
            </p>
            <div className="flex flex-wrap gap-1">
              {symbols.map((symbol) => (
                <SymbolButton
                  key={symbol.command}
                  symbol={symbol}
                  onInsert={() =>
                    setRecent((r) =>
                      [symbol, ...r.filter((s) => s.command !== symbol.command)].slice(0, 8)
                    )
                  }
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function SymbolButton({
  symbol,
  onInsert,
}: {
  symbol: SymbolEntry
  onInsert: () => void
}): React.JSX.Element {
  const rendered = useMemo(() => renderKatex(symbol.command), [symbol.command])
  return (
    <button
      className="flex h-9 w-14 flex-col items-center justify-center rounded-[var(--radius-sm)] border border-[var(--border-subtle)] hover:bg-[var(--bg-hover)]"
      title={`${symbol.name} — ${symbol.command}`}
      onClick={() => {
        void navigator.clipboard.writeText(symbol.command)
        onInsert()
        // Insertion at cursor goes through the editor's paste path.
        void insertIntoEditor(symbol.command)
      }}
    >
      {rendered ? (
        <span className="katex-mini" dangerouslySetInnerHTML={{ __html: rendered }} />
      ) : (
        <span className="font-mono text-[11px]">{symbol.command}</span>
      )}
    </button>
  )
}

/** Insert the command into the active editor via the clipboard-based path. */
async function insertIntoEditor(command: string): Promise<void> {
  // Use the document execCommand insertText for the focused CodeMirror view.
  const active = document.activeElement
  if (
    active instanceof HTMLElement &&
    (active.classList.contains('cm-content') || active.closest('.cm-editor'))
  ) {
    active.focus()
    document.execCommand('insertText', false, command)
  } else {
    void command
  }
}
