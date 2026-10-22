import { useEffect, useState } from 'react'
import { useProjectIndex } from '../stores/projectIndex'
import { useUiStore } from '../stores/ui'
import { api } from '../api'
import { wordCount } from '../editor/latex-utils'

interface Row {
  file: string
  section: string
  words: number
}

export function WordCountDialog(): React.JSX.Element | null {
  const open = useUiStore((s) => s.wordCountOpen)
  const setOpen = useUiStore((s) => s.setWordCountOpen)
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    void (async () => {
      setLoading(true)
      const structures = useProjectIndex.getState().structures
      const files = [...structures.keys()]
      const response = await api.invoke('files:readMany', { relPaths: files })
      const next: Row[] = []
      let sum = 0
      if (response.ok) {
        for (const [file, structure] of structures) {
          const content = response.data[file] ?? ''
          const sections = [...structure.sections].sort((a, b) => a.position - b.position)
          if (sections.length === 0) {
            const words = wordCount(content)
            next.push({ file, section: '(whole file)', words })
            sum += words
            continue
          }
          for (let index = 0; index < sections.length; index++) {
            const start = sections[index].position
            const end = sections[index + 1]?.position ?? content.length
            const words = wordCount(content.slice(start, end))
            next.push({ file, section: sections[index].title || '(untitled)', words })
            sum += words
          }
        }
      }
      setRows(next.sort((a, b) => b.words - a.words))
      setTotal(sum)
      setLoading(false)
    })()
  }, [open])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={() => setOpen(false)}
      data-testid="wordcount-dialog"
    >
      <div
        className="flex max-h-[75vh] w-[520px] flex-col overflow-hidden rounded-[var(--radius-lg)] border border-[var(--border-subtle)] bg-[var(--bg-elevated)] p-4 shadow-[var(--shadow-popover)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Word count details</h2>
          <span className="text-[12px] text-[var(--text-secondary)]">
            {total.toLocaleString()} words total
          </span>
        </div>
        <p className="mb-2 text-[11px] text-[var(--text-tertiary)]">
          Estimated from the project source (sections split at headings).
        </p>
        <div className="min-h-0 flex-1 overflow-auto">
          {loading ? (
            <p className="py-6 text-center text-[13px] text-[var(--text-tertiary)]">Counting…</p>
          ) : (
            <table className="w-full text-[13px]">
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={`${row.file}-${row.section}-${index}`}
                    className="border-b border-[var(--border-subtle)]/50"
                  >
                    <td className="py-1 pr-2">
                      <span className="block truncate">{row.section}</span>
                      <span className="block truncate text-[10px] text-[var(--text-tertiary)]">
                        {row.file}
                      </span>
                    </td>
                    <td className="w-16 py-1 text-right tabular-nums">{row.words}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <button
          className="mt-3 self-end rounded-[var(--radius-sm)] border border-[var(--border-subtle)] px-3 py-1 text-[13px] hover:bg-[var(--bg-hover)]"
          onClick={() => setOpen(false)}
        >
          Close
        </button>
      </div>
    </div>
  )
}
