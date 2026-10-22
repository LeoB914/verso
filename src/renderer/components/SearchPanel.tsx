import { useEffect, useState } from 'react'
import { ReplaceAll } from 'lucide-react'
import type { SearchFileResult, SearchOptions } from '@shared/ipc'
import { api, invokeOrThrow } from '../api'
import { useEditorStore } from '../stores/editor'

export function SearchPanel(): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)
  const [wholeWord, setWholeWord] = useState(false)
  const [regex, setRegex] = useState(false)
  const [results, setResults] = useState<SearchFileResult[]>([])
  const [searching, setSearching] = useState(false)
  const [replaceConfirmation, setReplaceConfirmation] = useState<string | null>(null)
  const applyJump = useEditorStore((s) => s.applyJump)

  const options: SearchOptions = { caseSensitive, wholeWord, regex }

  // Streamed results.
  useEffect(() => {
    return api.on('search:results', ({ batch, done }) => {
      setResults((prev) => (done ? [...prev, ...batch] : [...prev, ...batch]))
      if (done) setSearching(false)
    })
  }, [])

  const runSearch = (): void => {
    if (!query) return
    setResults([])
    setSearching(true)
    void api.invoke('search:run', { query, options })
  }

  const replaceAll = async (): Promise<void> => {
    if (!query) return
    const confirmed = await invokeOrThrow('dialog:confirm', {
      title: 'Replace all',
      message: `Replace all occurrences of "${query}" with "${replacement}" across the project?`,
      confirmLabel: 'Replace all',
    })
    if (!confirmed) return
    const result = await invokeOrThrow('search:replaceAll', { query, options, replacement })
    setReplaceConfirmation(`${result.changedFiles.length} file(s) updated`)
    // Reload open tabs whose file changed.
    const { tabs, reloadTab } = useEditorStore.getState()
    for (const relPath of result.changedFiles) {
      if (tabs.some((t) => t.relPath === relPath)) {
        void reloadTab(relPath)
      }
    }
    setTimeout(() => setReplaceConfirmation(null), 4000)
    runSearch()
  }

  return (
    <div className="flex h-full flex-col" data-testid="search-panel">
      <div className="flex flex-col gap-1.5 px-2 pt-1.5">
        <input
          className="h-6 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 text-[13px]"
          placeholder="Search in project…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch()
          }}
          data-testid="search-input"
        />
        <input
          className="h-6 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 text-[13px]"
          placeholder="Replace with…"
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
        />
        <div className="flex items-center gap-2 text-[12px] text-[var(--text-secondary)]">
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={caseSensitive}
              onChange={(e) => setCaseSensitive(e.target.checked)}
            />
            Aa
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={wholeWord}
              onChange={(e) => setWholeWord(e.target.checked)}
            />
            Word
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
            .*
          </label>
          <button
            className="ml-auto flex items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-2 py-0.5 hover:bg-[var(--bg-hover)] disabled:opacity-50"
            onClick={() => void replaceAll()}
            disabled={!query || searching}
            title="Replace all in project"
          >
            <ReplaceAll size={13} />
            Replace all
          </button>
        </div>
        {replaceConfirmation && (
          <p className="text-[12px] text-[var(--success)]">{replaceConfirmation}</p>
        )}
      </div>
      <div className="mt-1 flex-1 overflow-auto px-2 pb-2">
        {results.map((file) => (
          <div key={file.relPath} className="mb-2">
            <p className="truncate text-[12px] font-semibold text-[var(--text-secondary)]">
              {file.relPath}
            </p>
            {file.matches.slice(0, 50).map((match, i) => (
              <button
                key={`${match.line}-${match.column}-${i}`}
                className="block w-full truncate rounded-[var(--radius-sm)] py-0.5 pl-3 text-left text-[13px] hover:bg-[var(--bg-hover)]"
                onClick={() => void applyJump(file.relPath, match.line)}
              >
                <span className="text-[var(--text-tertiary)]">{match.line}: </span>
                {match.preview}
              </button>
            ))}
          </div>
        ))}
        {searching && (
          <p className="px-2 py-2 text-[12px] text-[var(--text-tertiary)]">Searching…</p>
        )}
        {!searching && query && results.length === 0 && (
          <p className="px-2 py-2 text-[12px] text-[var(--text-tertiary)]">No results</p>
        )}
      </div>
    </div>
  )
}
