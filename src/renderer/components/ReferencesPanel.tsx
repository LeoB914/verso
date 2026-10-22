import { useEffect, useMemo, useState } from 'react'
import { Plus, Search } from 'lucide-react'
import type { BibEntryLite } from '@shared/latex/bibliography'
import { citationReport } from '@shared/latex/bibliography'
import { parseBibFile } from '@shared/latex/bib-parser'
import { invokeOrThrow, api } from '../api'
import { askText } from '../stores/prompt'
import { useEditorStore } from '../stores/editor'
import { useSettingsStore } from '../stores/settings'
import { useProjectStore } from '../stores/project'
import { useProjectIndex } from '../stores/projectIndex'
import { CITE_COMMANDS } from '@shared/latex/citations'
import { cleanBib } from '@shared/latex/bib-clean'

/**
 * References sidebar tab: all .bib entries, searchable and grouped by type,
 * with add-entry actions (DOI import, paste BibTeX, manual form) and an
 * unused/missing report.
 */

function bibFilesOf(tree: ReturnType<typeof useProjectStore.getState>['fileTree']): string[] {
  const files: string[] = []
  function walk(node: NonNullable<typeof tree>): void {
    if (node.type === 'file' && node.relPath.toLowerCase().endsWith('.bib'))
      files.push(node.relPath)
    for (const child of node.children ?? []) walk(child)
  }
  if (tree) walk(tree)
  return files
}

export function ReferencesPanel(): React.JSX.Element {
  const [entries, setEntries] = useState<BibEntryLite[]>([])
  const [query, setQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string | null>(null)
  const [report, setReport] = useState<{ unused: string[]; missing: string[] } | null>(null)
  const [adding, setAdding] = useState(false)
  const openFileByPath = useEditorStore((s) => s.openFileByPath)
  const applyJump = useEditorStore((s) => s.applyJump)
  const fileTree = useProjectStore((s) => s.fileTree)
  const structures = useProjectIndex((s) => s.structures)
  const cited = useMemo(() => {
    const keys: string[] = []
    for (const structure of structures.values()) {
      for (const ref of structure.references) {
        if (ref.kind === 'cite') keys.push(...ref.key.split(',').map((k) => k.trim()))
      }
    }
    return keys
  }, [structures])

  const load = async (): Promise<void> => {
    const files = bibFilesOf(fileTree)
    const all: BibEntryLite[] = []
    for (const relPath of files) {
      try {
        const file = await invokeOrThrow('file:read', { relPath })
        for (const entry of parseBibFile(file.content)) {
          all.push({
            key: entry.key,
            type: entry.type,
            author: entry.fields.author,
            title: entry.fields.title,
            year: entry.fields.year,
            doi: entry.fields.doi,
            source: relPath,
            line: entry.line,
          })
        }
      } catch {
        // Skip unreadable files.
      }
    }
    setEntries(all)
    setReport(citationReport(all, cited))
  }

  useEffect(() => {
    void (async () => {
      await load()
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileTree])

  const filtered = useMemo(() => {
    let list = entries
    if (typeFilter) list = list.filter((e) => e.type === typeFilter)
    if (query) {
      const q = query.toLowerCase()
      list = list.filter(
        (e) =>
          e.key.toLowerCase().includes(q) ||
          (e.author ?? '').toLowerCase().includes(q) ||
          (e.title ?? '').toLowerCase().includes(q) ||
          (e.year ?? '').includes(q)
      )
    }
    return [...list].sort((a, b) => a.type.localeCompare(b.type) || a.key.localeCompare(b.key))
  }, [entries, query, typeFilter])

  const types = useMemo(() => [...new Set(entries.map((e) => e.type))].sort(), [entries])

  const insertCitation = (key: string): void => {
    const command = useSettingsStore.getState().settings?.citeCommand ?? 'cite'
    // Applied at the active editor's cursor by the CodeMirror effect
    // (adds to an existing \cite{…} list when the cursor is inside one).
    useEditorStore.getState().requestCitationInsert(command, key)
  }

  const citeCommand = useSettingsStore((s) => s.settings?.citeCommand ?? 'cite')

  return (
    <div className="flex h-full flex-col" data-testid="references-panel">
      <div className="flex flex-col gap-1.5 px-2 pt-1.5">
        <div className="flex h-6 items-center gap-1">
          <div className="flex h-6 min-w-0 flex-1 items-center gap-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2">
            <Search size={13} />
            <input
              className="w-full bg-transparent text-[13px] outline-none"
              placeholder="Search key, author, title…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <select
            className="h-6 shrink-0 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-1 text-[12px]"
            value={citeCommand}
            onChange={(e) =>
              void useSettingsStore.getState().update({ citeCommand: e.target.value as never })
            }
            title="Citation command used when inserting from this panel"
          >
            {CITE_COMMANDS.map((c) => (
              <option key={c} value={c}>
                \{c}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-wrap gap-1">
          {types.map((type) => (
            <button
              key={type}
              className={`rounded-full px-2 py-0.5 text-[11px] ${typeFilter === type ? 'bg-[var(--bg-selected)]' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'}`}
              onClick={() => setTypeFilter(typeFilter === type ? null : type)}
            >
              {type}
            </button>
          ))}
          <button
            className="rounded-full px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)]"
            onClick={() =>
              void (async () => {
                const files = bibFilesOf(fileTree)
                const updates: Array<{ relPath: string; content: string }> = []
                for (const relPath of files) {
                  try {
                    const file = await invokeOrThrow('file:read', { relPath })
                    const cleaned = cleanBib(file.content)
                    if (cleaned !== file.content) updates.push({ relPath, content: cleaned })
                  } catch {
                    // ignore unreadable bib files
                  }
                }
                if (updates.length > 0) {
                  await invokeOrThrow('files:writeMany', { files: updates })
                  await useProjectStore.getState().refreshTree()
                }
              })()
            }
            title="Sort entries by key and remove duplicate keys"
          >
            Clean up
          </button>
          <button
            className="rounded-full px-2 py-0.5 text-[11px] text-[var(--accent)] hover:bg-[var(--bg-hover)]"
            onClick={() => setAdding(true)}
            title="Add entry (DOI, paste BibTeX, or manual)"
          >
            <Plus size={13} className="inline" /> Add
          </button>
        </div>
        {report && (report.unused.length > 0 || report.missing.length > 0) && (
          <p className="text-[11px] text-[var(--text-tertiary)]">
            {report.unused.length} unused · {report.missing.length} missing citations
          </p>
        )}
      </div>
      <div className="mt-1 flex-1 overflow-auto px-2 pb-2">
        {filtered.map((entry) => (
          <div
            key={`${entry.source}-${entry.key}`}
            className="rounded-[var(--radius-sm)] px-1 py-1 hover:bg-[var(--bg-hover)]"
          >
            <button
              className="block w-full text-left"
              data-testid={`bib-entry-${entry.key}`}
              onClick={() =>
                void openFileByPath(entry.source, { readOnly: true }).then(() =>
                  applyJump(entry.source, entry.line ?? 1)
                )
              }
              title={`${entry.source} — click to open`}
            >
              <span className="block truncate text-[13px] font-medium">{entry.key}</span>
              <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                {entry.author ?? '—'} {entry.year ? `(${entry.year})` : ''} — {entry.title ?? ''}
              </span>
            </button>
            <button
              className="text-[11px] text-[var(--accent)]"
              onClick={() => insertCitation(entry.key)}
              data-testid={`insert-citation-${entry.key}`}
            >
              Insert citation
            </button>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="px-1 py-2 text-[12px] text-[var(--text-tertiary)]">
            No .bib entries yet. Add a references.bib or import via DOI.
          </p>
        )}
      </div>
      {adding && (
        <AddEntryDialog
          onDone={() => {
            setAdding(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function AddEntryDialog({ onDone }: { onDone: () => void }): React.JSX.Element {
  const [mode, setMode] = useState<'doi' | 'paste' | 'manual'>('doi')
  const [doi, setDoi] = useState('')
  const [paste, setPaste] = useState('')
  const [manual, setManual] = useState<{
    key: string
    type: string
    author: string
    title: string
    year: string
  }>({
    key: '',
    type: 'article',
    author: '',
    title: '',
    year: '',
  })
  const [status, setStatus] = useState<string | null>(null)
  const fileTree = useProjectStore((s) => s.fileTree)
  const project = useProjectStore((s) => s.project)
  void project

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onDone()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onDone])

  const bibTarget = bibFilesOf(fileTree)[0] ?? 'references.bib'

  const appendBibtex = async (entry: string, suggestedKey: string): Promise<void> => {
    const existing = await invokeOrThrow('file:read', { relPath: bibTarget }).catch(() => null)
    const current = existing?.content ?? ''
    const key =
      (await askText({
        title: 'Citation key',
        defaultValue: suggestedKey,
        confirmLabel: 'Add entry',
      })) ?? suggestedKey
    // Replace the generated key with the confirmed one.
    const withKey = entry.replace(/^(@\w+)\{[^,]+,/, `$1{${key},`)
    await invokeOrThrow('files:writeMany', {
      files: [
        {
          relPath: bibTarget,
          content: current + (current.endsWith('\n') ? '' : '\n\n') + withKey + '\n',
        },
      ],
    })
    // When references.bib did not exist yet, it was just created; refresh the
    // tree so the panel and file list pick it up immediately.
    await useProjectStore.getState().refreshTree()
    onDone()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={onDone}
    >
      <div
        className="w-[480px] rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-popover)]"
        onClick={(e) => e.stopPropagation()}
        data-testid="add-entry-dialog"
      >
        <div className="mb-3 flex gap-2">
          {(['doi', 'paste', 'manual'] as const).map((m) => (
            <button
              key={m}
              className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-[12px] ${mode === m ? 'bg-[var(--bg-selected)]' : 'bg-[var(--bg-hover)] text-[var(--text-secondary)]'}`}
              onClick={() => setMode(m)}
            >
              {m === 'doi' ? 'DOI / arXiv' : m === 'paste' ? 'Paste BibTeX' : 'Manual'}
            </button>
          ))}
        </div>
        <p className="mb-2 text-[12px] text-[var(--text-tertiary)]">Target file: {bibTarget}</p>

        {mode === 'doi' && (
          <div className="flex flex-col gap-2">
            <input
              className="h-7 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 text-[13px]"
              placeholder="10.1000/xyz or https://doi.org/10.1000/xyz"
              value={doi}
              onChange={(e) => setDoi(e.target.value)}
            />
            <button
              className="self-start rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-[13px] text-[var(--accent-contrast)]"
              onClick={() =>
                void (async () => {
                  setStatus('Fetching…')
                  const result = await api.invoke('bib:fetchDoi', { doi })
                  if (result.ok && result.data) {
                    await appendBibtex(result.data.bibtex, result.data.key)
                  } else {
                    setStatus('Could not fetch metadata for this DOI.')
                  }
                })()
              }
            >
              Fetch & add
            </button>
          </div>
        )}

        {mode === 'paste' && (
          <div className="flex flex-col gap-2">
            <textarea
              className="h-32 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] p-2 font-mono text-[12px]"
              placeholder="@article{key, author = {...}, ...}"
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <button
              className="self-start rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-[13px] text-[var(--accent-contrast)]"
              onClick={() =>
                void (async () => {
                  if (!paste.trim().startsWith('@')) {
                    setStatus('That does not look like BibTeX.')
                    return
                  }
                  const key = /@\w+\{([^,]+),/.exec(paste)?.[1] ?? 'new-entry'
                  await appendBibtex(paste.trim(), key)
                })()
              }
            >
              Validate & add
            </button>
          </div>
        )}

        {mode === 'manual' && (
          <div className="flex flex-col gap-2 text-[13px]">
            {(
              [
                ['key', 'Citation key'],
                ['author', 'Author'],
                ['title', 'Title'],
                ['year', 'Year'],
              ] as const
            ).map(([field, label]) => (
              <label className="flex items-center gap-2">
                <span className="w-24 text-[var(--text-secondary)]">{label}</span>
                <input
                  className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                  value={manual[field]}
                  onChange={(e) => setManual({ ...manual, [field]: e.target.value })}
                />
              </label>
            ))}
            <label className="flex items-center gap-2">
              <span className="w-24 text-[var(--text-secondary)]">Type</span>
              <select
                className="h-7 flex-1 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2"
                value={manual.type}
                onChange={(e) => setManual({ ...manual, type: e.target.value })}
              >
                {[
                  'article',
                  'book',
                  'inproceedings',
                  'misc',
                  'online',
                  'phdthesis',
                  'mastersthesis',
                ].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <button
              className="self-start rounded-[var(--radius-md)] bg-[var(--accent)] px-3 py-1 text-[13px] text-[var(--accent-contrast)]"
              onClick={() =>
                void (async () => {
                  const bibtex = [
                    `@${manual.type}{${manual.key || generateKeyFallback(manual)},`,
                    `  author = {${manual.author}},`,
                    `  title = {${manual.title}},`,
                    `  year = {${manual.year}},`,
                    '}',
                  ].join('\n')
                  await appendBibtex(bibtex, manual.key || generateKeyFallback(manual))
                })()
              }
            >
              Add entry
            </button>
          </div>
        )}

        {status && <p className="mt-2 text-[12px] text-[var(--warning)]">{status}</p>}
      </div>
    </div>
  )
}

function generateKeyFallback(entry: { author: string; year: string; title: string }): string {
  const author = entry.author.split(/\s+/).pop()?.toLowerCase() ?? 'unknown'
  return `${author.replace(/[^a-z]/g, '')}${entry.year}${
    entry.title
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z]/g, '') ?? ''
  }`
}
