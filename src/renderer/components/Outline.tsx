import { useState } from 'react'
import { useEditorStore } from '../stores/editor'
import { useProjectIndex } from '../stores/projectIndex'

export function Outline(): React.JSX.Element {
  const outline = useProjectIndex((s) => s.outline)
  const applyJump = useEditorStore((s) => s.applyJump)
  const activePath = useEditorStore((s) => s.activePath)
  const [query, setQuery] = useState('')

  const filtered = query
    ? outline.filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
    : outline

  return (
    <div className="flex h-full flex-col" data-testid="outline-panel">
      <input
        className="mx-2 mt-1 h-6 rounded-[var(--radius-sm)] border border-[var(--border-subtle)] bg-[var(--bg-content)] px-2 text-[13px]"
        placeholder="Filter sections…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="mt-1 flex-1 overflow-auto px-2 pb-2">
        {filtered.length === 0 ? (
          <p className="px-2 py-3 text-[13px] text-[var(--text-tertiary)]">No sections yet</p>
        ) : (
          filtered.map((section, index) => (
            <button
              key={`${section.relPath}-${section.position}-${index}`}
              className="flex w-full items-baseline gap-1.5 rounded-[var(--radius-sm)] py-[3px] pr-2 text-left hover:bg-[var(--bg-hover)]"
              style={{ paddingLeft: 8 + Math.min(section.level, 6) * 12 }}
              onClick={() => {
                if (activePath !== section.relPath) {
                  void useEditorStore
                    .getState()
                    .openFileByPath(section.relPath)
                    .then(() => {
                      void applyJump(section.relPath, section.line)
                    })
                } else {
                  void applyJump(section.relPath, section.line)
                }
              }}
            >
              <span
                className={`truncate text-[${section.level <= 1 ? '12px' : '13px'}] ${section.level <= 1 ? 'font-semibold' : ''}`}
              >
                {section.title || '(untitled)'}
              </span>
              {section.relPath !== activePath && (
                <span className="ml-auto shrink-0 text-[11px] text-[var(--text-tertiary)]">
                  {section.relPath.split('/').pop()}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
