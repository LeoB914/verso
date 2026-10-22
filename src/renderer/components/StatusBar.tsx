import { useEffect, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { useEditorStore } from '../stores/editor'
import { useProjectStore } from '../stores/project'
import { useCompileStore } from '../stores/compile'
import { useSettingsStore } from '../stores/settings'
import { api } from '../api'
import { strings } from '../strings'
import { wordCount } from '../editor/latex-utils'
import { runCommand } from '../commands'

export function StatusBar(): React.JSX.Element {
  const cursor = useEditorStore((s) => s.cursorInfo)
  const tabs = useEditorStore((s) => s.tabs)
  const activePath = useEditorStore((s) => s.activePath)
  const openFile = tabs.find((t) => t.relPath === activePath)
  const project = useProjectStore((s) => s.project)
  const texEnvironment = useCompileStore((s) => s.texEnvironment)
  const texcount = useCompileStore((s) => s.wordcount)
  const vimEnabled = useSettingsStore((s) => s.settings?.vimEnabled ?? false)
  const vimMode = useEditorStore((s) => s.vimMode)
  const projectPath = useProjectStore((s) => s.project?.path)
  const [branch, setBranch] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      if (!projectPath) {
        setBranch(null)
        return
      }
      const status = await api.invoke('git:status', undefined)
      setBranch(status.ok && status.data ? status.data.branch : null)
    })()
  }, [projectPath])

  // Prefer the real texcount result (whole project); fall back to a local
  // estimate of the open file while texcount is unavailable.
  const words = texcount?.words ?? wordCount(openFile?.content ?? '')
  const wordsExact = texcount !== null

  return (
    <div className="flex h-[28px] shrink-0 items-center gap-4 border-t border-[var(--border-subtle)] bg-[var(--bg-elevated)] px-3 text-[12px] text-[var(--text-secondary)]">
      <span data-testid="status-cursor">{strings.statusLine(cursor.line, cursor.column)}</span>
      <button
        title={
          wordsExact
            ? 'Project word count (texcount) — click for details'
            : 'Estimated for the open file — click for details'
        }
        onClick={() => runCommand('wordcount.details')}
        className="hover:text-[var(--text-primary)]"
        data-testid="wordcount-button"
      >
        {strings.statusWordCount(words)}
      </button>
      <span className="capitalize">
        {project?.config.spellLanguage === 'de' ? 'German' : 'English (US)'}
      </span>
      {vimEnabled && (
        <span
          className="rounded bg-[var(--bg-hover)] px-1.5 font-semibold"
          data-testid="vim-indicator"
        >
          {(vimMode ?? 'VIM').toUpperCase()}
        </span>
      )}
      {branch && (
        <span className="flex items-center gap-1" title="Current Git branch">
          <GitBranch size={12} />
          {branch}
        </span>
      )}
      <span className="truncate" title={texEnvironment?.tools.latexmk?.path}>
        {texEnvironment?.tools.latexmk
          ? `TeX: ${texEnvironment.tools.latexmk.version ?? 'ok'}`
          : 'TeX: not found'}
      </span>
      <div className="flex-1" />
      <span className="truncate text-[var(--text-tertiary)]">{openFile?.relPath ?? ''}</span>
    </div>
  )
}
